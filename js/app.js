require.config({
    baseUrl: 'js',
    paths: {
        jquery: 'http://cdn.jsdelivr.net/jquery/2.1.1/jquery.min',
        underscore: 'http://cdn.jsdelivr.net/underscorejs/1.6.0/underscore-min',
        eventemitter: 'lib/eventemitter2',
        inherits: 'lib/inherits',
        eos: 'eos'
    },
    shim: {
        'underscore': {
            exports: '_'
        }
    }
});

require(
    [
        'jquery',
        'underscore',
        'eos',
        'ui'
    ],
    function ($, _, eos, ui) {

        // Binding UI
        ui.logWindow     = $('#logWindow');
        var dsnInput      = $('#dsn');
        var connectButton = $('#connect');
        var clearButton = $('#clearButton');

        dsnInput.val("127.0.0.1:8090");
        connectButton.click(function(){
            if (eos.connected) {
                eos.disconnect();
            } else {
                var split = dsnInput.val().split(":");
                eos.connect(split[0], split[1]);
            }
        });

        clearButton.click(function() {
            ui.logWindow.empty();
            eos.clear();
        });

        // Registering events
//        eos.on("log", function(payload) { console.debug(payload); });
//        eos.on("debug", function(payload) { console.debug(payload); });
        eos.on("disconnect", function(){
            dsnInput.prop('disabled', false);
            connectButton.attr("value", "connect");
        });
        eos.on("connected", function(){
            dsnInput.prop('disabled', true);
            connectButton.attr("value", "disconnect");
        });
        eos.on("newLogEntry", function(data) {
            ui.updateGroup(data.group);
        });

        eos.disconnect();
    }
);