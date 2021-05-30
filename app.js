const log = require('lambda-log');
const http = require('http');
const Bridge = require('./bridge').Bridge;

class App {
    constructor() {
        this.serverStatus = 'DOWN';
        this.bridge = null;
        this.httpServer = null;
    }

    launch() {
        log.info(`Starting sf-streaming-sns-bridge v${process.env.npm_package_version}`);
        
        const PORT = process.env.BRIDGE_PORT || process.env.PORT || 8080;
        
        this.bridge = new Bridge();
        
        // Exposing REST API
        this.httpServer = http.createServer((req, res) => {
            const bodyPromise = this.handleHttpRequest(req);
            bodyPromise.catch(e => {
                let body;
                if (e.statusCode) {
                    body = e;
                } else {
                    body = {error: `${e}`};
                }
        
                if (!e.statusCode || e.statusCode !== 404) {
                    log.error(e, {description: `Failed to handle request '${url}'`});
                }
                return body;
            })
            .then(body => {
                res.writeHead(body.statusCode? body.statusCode : (body.error? 500 : 200), {'Content-Type': 'application/json'});
                res.write(JSON.stringify(body));
                res.end();
            });
        }).listen(PORT);
        log.info(`Listening on ${PORT}`);
        this.serverStatus = 'UP';
        
        // Start the bridge
        try {
            this.bridge.reload();
        } catch (error) {
            log.error(error);
            this.httpServer.close();
        }
    }

    shutdown() {
        if (this.bridge) {
            this.bridge.stopAll();
        }
        if (this.httpServer) {
            this.httpServer.close();
        }
    }

    handleHttpRequest(req) {
        const url = req.url;
        let bodyPromise;
    
        if (url.startsWith('/health')) {
            bodyPromise = Promise.resolve({status: this.serverStatus});
        } else if (url.startsWith('/status')) { // status for all channels
            bodyPromise = Promise.resolve(this.bridge.status());
        } else if (url.startsWith('/reload')) { // reload configurations and restart the bridge
            bodyPromise = this.bridge.reload().then(() => ({succeeded: true}));
        } else {
            bodyPromise = Promise.resolve({statusCode: 404});
        }
        return bodyPromise;
    }
}

module.exports = { App };