"use strict";

const http = require('http');
const Bridge = require('./bridge').Bridge;

const PORT = process.env.BRIDGE_PORT || process.env.PORT || 8080;
const RELOAD_INTERVAL = process.env.BRIDGE_RELOAD_INTERVAL || 30; // minutes

let serverStatus = 'DOWN';

const bridge = new Bridge();

// Exposing REST API
http.createServer(function (req, res) {
    const url = req.url;
    let bodyPromise;

    if (url.startsWith('/health')) {
        bodyPromise = Promise.resolve({status: serverStatus});
    } else if (url.startsWith('/status')) { // status for channels
        bodyPromise = bridge.status();
    } else if (url.startsWith('/reload')) { // reload configurations
        bodyPromise = bridge.reload().then(() => ({succeeded: true}));
    }

    bodyPromise.catch(e => {
        console.log('Error', e);
        return {error: `${e}`};
    })
    .then(body => {
        res.writeHead(bodyPromise.error? 500 : 200, {'Content-Type': 'application/json'});
        res.write(JSON.stringify(bodyPromise));
        res.end();
    });
}).listen(PORT);
console.log(`Listening on ${PORT}`);
serverStatus = 'UP';

// Start the bridge
bridge.loadConfig()
.then(() => bridge.startAll())
.catch(e => {
    console.log(`Failed to start: ${e}`);
})
.then(() => {
    setInterval(bridge.reload.bind(bridge), RELOAD_INTERVAL * 60000);
});
