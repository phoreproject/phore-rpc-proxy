const request = require('request'),
    config = require('./config.js'),
    eventNames = require('./eventNames.js'),
    bloomFilter = require('bloom-filter');


function createJsonData(method) {
    let args = [];
    for (let i = 1; i < arguments.length; i++) {
        args.push(arguments[i]);
    }
    return {"jsonrpc": "2.0", "method": method, "params": args, "id": 1}
}

function createBasicAuthHeader() {
    return {
        Authorization: "Basic " + Buffer.from(config.rpc_user + ":" + config.rpc_pass).toString("base64")
    }
}

function sendRpcCall(rpcCommand, callback, ...arg) {
    return request.post(config.phored_host + ':' + config.phored_rpc_port, {
        headers: createBasicAuthHeader(),
        json: createJsonData(rpcCommand, ...arg),
    }, callback);
}

function downloadBlock(blockHash, callback) {
    return sendRpcCall(eventNames.rpc.getblock, callback, blockHash);
}

function downloadRawTransactionVerbose(txHash, callback) {
    // set verbose to true (last parameter = 1)
    return sendRpcCall(eventNames.rpc.getrawtransaction, callback, txHash, 1);
}

class Subscriber {
    constructor() {
        this.clientIds = {};
        this.subscribedToAddressMempool = {};
        this.subscribedToAddress = {};
        this.subscribedToBloomMempool = {};
        this.subscribedToBloom = {};
    }

    broadcastAddressMessage(address, tx, mempool) {
        let subscribedDict = this.subscribedToAddress;
        if (mempool) {
            subscribedDict = this.subscribedToAddressMempool;
        }

        if (!(address in subscribedDict)) {
            console.log("Nobody subscribed to address:", address);
            return;
        }

        for (let i = 0; i < subscribedDict[address].length; i++) {
            const userId = subscribedDict[address][i];

            if (!(userId in this.clientIds)) {
                console.log("User id:", userId, "is missing!");
                continue;
            }

            let userSocket = this.clientIds[userId];
            userSocket.emit(eventNames.canals.subscribeAddressRoom, address, tx, mempool);
        }
    }

    broadcastTransactionMessage(tx, mempool, message) {
        let subscribedDict = this.subscribedToBloom;
        if (mempool) {
            subscribedDict = this.subscribedToBloomMempool;
        }

        for (let userId in this.clientIds) {
            if (!this.clientIds.hasOwnProperty(userId)) {
                continue;
            }

            if (!(userId in subscribedDict)) {
                continue;
            }

            for (let filterId = 0; filterId < subscribedDict[userId].length; filterId++) {
                const filter = subscribedDict[userId][filterId];

                if (filter.contains(tx)) {
                    this.clientIds[userId].emit(message);
                }
            }
        }
    }

    parseRawTransactionForAddress(txHash, err, res, body, mempool){
        if(err){
            console.log(err);
        }
        else if (res && res.statusCode !== 200) {
            return console.log("Failed download", eventNames.rpc.getrawtransaction, "with params:", txHash,
                "because", body.error.message);
        }

        if (body.result === undefined ||
            body.result['vout'] === undefined){
            console.log("Transaction wrong format: ", body.result);
            return;
        }

        for (let i = 0; i < body.result["vout"].length; i++) {
            const tx = body.result["vout"][i];

            this.broadcastTransactionMessage(body.result, mempool, tx);

            if (tx["scriptPubKey"] === undefined || tx["scriptPubKey"]["addresses"] === undefined){
                continue;
            }

            for (let j = 0; j < tx["scriptPubKey"]["addresses"].length; j++) {
                const address = tx["scriptPubKey"]["addresses"][j];
                // TODO tx? check
                this.broadcastAddressMessage(address, tx, mempool);
            }
        }
    }

    processTxs(txs) {
        for (let i = 0; i < txs.length; i++) {
            // get raw transactions from phored
            downloadRawTransactionVerbose(txs[i], (err, res, body) => {
                this.parseRawTransactionForAddress(txs[i], err, res, body, false);
            });
        }
    }

    processMempoolTx(tx) {
        downloadRawTransactionVerbose(tx, (err, res, body) => {
            this.parseRawTransactionForAddress(tx, err, res, body, true);
        });
    }

    async processBlockNotifyEvent(blockHash) {
        return new Promise((resolve, reject) => {
            // gen info about block from phored
            downloadBlock(blockHash,
                (err, res, body) => {
                    if (err) {
                        return reject(err);
                    }
                    else if ((res && res.statusCode !== 200) || body.error !== null) {
                        let errorMsg = body.error.message !== undefined ? body.error.message : "empty";
                        return reject("Failed download " + eventNames.rpc.getblock + "with params: " + (blockHash || "empty") +
                            ", because: " + errorMsg);
                    }

                    if (body.result !== null && body.result['tx'] !== undefined) {
                        this.processTxs(body.result['tx']);
                    }
                    else {
                        console.log("Unknown error");
                        return reject("Unknown error");
                    }

                    console.log("Success download", eventNames.rpc.getblock, "with params:", blockHash || "empty");
                    resolve(body.result);
                });
        }).catch((err) => {
            console.log(err);
        });
    }

    processMemPoolEvent(txHash) {
        this.processMempoolTx(txHash);
    }

    static appendToDict(dict, key, value) {
        if (key in dict) {
            dict[key].append(value);
        }
        else {
            dict[key] = [value];
        }
    }

    static removeIfValueExists(dict, dictValue) {
        for (let key in dict) {
            if (dict.hasOwnProperty(key)) {
                const index = dict[key].indexOf(dictValue);
                if (index !== -1) {
                    dict[key].splice(index, 1);
                }
                if (dict[key].length === 0) {
                    delete dict[key];
                }
            }
        }
    }

    static removeIfKeyExists(dict, key) {
        if (key in dict) {
            delete dict[key];
        }
    }

    unsubscribeAll(socket) {
        Subscriber.removeIfKeyExists(this.clientIds, socket.id);
        Subscriber.removeIfValueExists(this.subscribedToAddressMempool, socket.id);
        Subscriber.removeIfValueExists(this.subscribedToAddress, socket.id);
        Subscriber.removeIfKeyExists(this.subscribedToBloom, socket.id);
        Subscriber.removeIfKeyExists(this.subscribedToBloomMempool, socket.id);
    }

    subscribeAddress(socket, address, includeMempool) {
        this.clientIds[socket.id] = socket;

        if (includeMempool === eventNames.includeTransactionType.include_all) {
            Subscriber.appendToDict(this.subscribedToAddressMempool, address, socket.id);
            Subscriber.appendToDict(this.subscribedToAddress, address, socket.id);
        } else if (includeMempool === eventNames.includeTransactionType.only_confirmed) {
            Subscriber.appendToDict(this.subscribedToAddress, address, socket.id);
        } else {
            Subscriber.appendToDict(this.subscribedToAddressMempool, address, socket.id);
        }
    }

    subscribeBloom(socket, filterHex, hashFunc, tweak, includeMempool, flags) {
        this.clientIds[socket.id] = socket;
        const filter = new bloomFilter({
            vData: filterHex,
            nHashFuncs: hashFunc,
            nTweak: tweak,
            nFlags: flags,
        });
        if (includeMempool === eventNames.includeTransactionType.include_all) {
            Subscriber.appendToDict(this.subscribedToBloomMempool, socket.id, filter);
            Subscriber.appendToDict(this.subscribedToBloom, socket.id, filter);
        } else if (includeMempool === eventNames.includeTransactionType.only_confirmed) {
            Subscriber.appendToDict(this.subscribedToBloom, socket.id, filter);
        } else {
            Subscriber.appendToDict(this.subscribedToBloomMempool, socket.id, filter);
        }
    }
}

module.exports = {
    Subscriber: Subscriber
};
