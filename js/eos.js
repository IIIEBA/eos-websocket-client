define(['underscore', 'eventemitter', 'inherits'], function(_, emitter, inherits) {

    var EosKeySchema = /^([a-z]+):\/\/([^:]+)/i;
    var EosDefaultId = '--default--';
    var EosLoggingKey = new EosKey("log://eos");

    /**
     * EosKey object
     *
     * @param source
     * @constructor
     */
    function EosKey(source) {
        if (!_.isString(source)) {
            throw "Not valid key source provided";
        }

        this.src = source;

        var m = EosKeySchema.exec(source);
        if (!m) {
            throw "Cannot parse schema";
        }
        this.schema = m[1];
        this.key    = m[2];
        this.tags   = source.replace(EosKeySchema, "").trim().split(":").filter(function(x){ return x !== ""; });
    }



    /**
     * Eos log entry constructor
     *
     * @param {EosKey} key
     * @param {string|object} data
     * @constructor
     */
    function EosLogEntry(key, data) {
        this.key     = key;
        this.data    = data;
        this.message = data;
        this.index   = 1;
        if (_.isString(data)) {
            try {
                this.object = JSON.parse(data);
            } catch (e) {
                this.object = {};
            }
        } else {
            this.object = data;
        }
        this.message = (!this.object.message) ? this.data : this.object.message;
        this._id = this.object["eos-id"];
        this.receivedAt = new Date();
    }

    /**
     * Returns id
     *
     * @returns {string}
     */
    EosLogEntry.prototype.getId = function getId() {
        if (this._id) {
            return this._id;
        } else {
            return EosDefaultId;
        }
    };

    /**
     * Returns short message to display in brief listing
     *
     * @returns {string}
     */
    EosLogEntry.prototype.getShortMessage = function getShortMessage() {
        return this.message;
    };

    /**
     * Returns true if current entry has information about exception
     *
     * @returns {boolean}
     */
    EosLogEntry.prototype.hasException = function hasException() {
        return this.object && this.object.exception;
    };

    /**
     * Returns true if current entry has raw SQL
     *
     * @returns {boolean}
     */
    EosLogEntry.prototype.hasSql = function hasSql() {
        return this.object && this.object.sql;
    };

    /**
     * Returns true if current entry has raw performance info
     *
     * @returns {boolean}
     */
    EosLogEntry.prototype.hasPerformanceLog = function hasPerformanceLog() {
        return this.object && this.object.time;
    };

    /**
     * Constructor of Eos log entries group
     *
     * @param {string} id
     * @constructor
     */
    function EosLogGroup(id) {
        this.id     = id;
        this.items  = [];
        this.count  = 0;

        this.sharedTags = null;

        this.sqlCount    = 0;
        this.errorsCount = 0;
        this.performance = 0;

        this.firstReceivedAt = new Date();
        this.lastReceivedAt = new Date();
    }

    /**
     * Adds new log entry to group
     *
     * @param {EosLogEntry} entry
     */
    EosLogGroup.prototype.add = function add(entry) {
        this.count++;
        this.lastReceivedAt = entry.receivedAt;
        if (entry.hasException()) {
            this.errorsCount++;
        }
        if (entry.hasSql()) {
            this.sqlCount++;
        }
        if (entry.hasPerformanceLog()) {
            this.performance += entry.object.perf;
        }

        // Registering shared tags
        if (entry.key.tags) {
            // Entry has tags
            if (this.sharedTags === null) {
                this.sharedTags = entry.key.tags;
            } else if (this.sharedTags.length === 0) {
                // Do nothing - intersection empty already
            } else {
                // Calculating intersection
                this.sharedTags = _.intersection(this.sharedTags, entry.key.tags);
            }
        }

        this.items.push(entry);
    };

    /**
     * Returns list of shared tags in group
     *
     * @return {string[]}
     */
    EosLogGroup.prototype.getSharedTags = function getSharedTags() {
        if (this.sharedTags) {
            return this.sharedTags;
        } else {
            return [];
        }
    };

    /**
     * Main Eos service
     *
     * @constructor
     */
    function Eos() {
        emitter.constructor.call(this);

        this.socket    = null;
        this.connected = false;
        this.groups    = {};
    }
    inherits(Eos, emitter);

    /**
     * Connects to websocket server
     *
     * @param server
     * @param port
     */
    Eos.prototype.connect = function connect(server, port) {
        this.disconnect();

        var uri  = "ws://" + server + ":" + port;
        var self = this;
        this.emit("log", "Connecting to " + uri);
        this.socket = new WebSocket(uri);
        this.socket.onopen  = function(){
            self.connected = true;
            self.logSelf("Successfully connected to " + uri);
            self.emit("connected");
        };
        this.socket.onerror = function(){
            self.logSelf("Connection failed");
            self.emit("connectionError");
        };
        this.socket.onclose   = this.disconnect.bind(this);
        this.socket.onmessage = this.onWebsocketMessage.bind(this);
    };

    /**
     * Utility function to log health information
     *
     * @param {string} msg
     * @param {object=} object
     */
    Eos.prototype.logSelf = function logSelf(msg, object) {
        this.emit("log", msg);
        this.addLogEntry(new EosLogEntry(EosLoggingKey, {'message': msg, 'eos-id': 'eos', 'object': object}));
    };

    /**
     * Disconnects from server
     */
    Eos.prototype.disconnect = function disconnect() {
        this.logSelf("Disconnecting");
        this.emit("disconnect");
        if (this.connected) {
            this.connected = false;
            this.socket.close();
            this.socket = null;
        }
    };

    /**
     * Function, called on incoming packet
     */
    Eos.prototype.onWebsocketMessage = function onWebsocketMessage(packet) {
        this.emit("debug", "Received packet");
        this.emit("debug", packet);

        // Splitting
        var parts = packet.data.split("\n");
        var key   = new EosKey(parts.shift());
        var data  = parts.join("\n");

        if (key.schema === 'log') {
            var entry = new EosLogEntry(key, data);
            this.emit("debug", entry);
            this.addLogEntry(entry);
        } else {
            this.logSelf("Unknown schema " + key.schema);
        }
    };

    /**
     * Adds new log entry to corresponding group
     *
     * @param {EosLogEntry} entry
     */
    Eos.prototype.addLogEntry = function addLogEntry(entry) {
        var id    = entry.getId();
        var group = this.groups[id];
        if (!group) {
            group = new EosLogGroup(id);
            this.groups[id] = group;
        }

        group.add(entry);
        entry.index = group.count;
        this.emit("newLogEntry", {entry: entry, group: group});
    };

    return new Eos();
});