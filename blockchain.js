'use strict';
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");
var fs = require("fs");

var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];

var blockchainFilePath = "blockchain.json"

class Block {
    constructor(index, previousHash, timestamp, data, hfile, hash, nonce) {
        this.index = index;
        this.previousHash = previousHash;//.toString();
        this.timestamp = timestamp;
        this.data = data;
	    this.hfile = hfile;
        this.hash = hash;//.toString();
	    this.nonce = 0;
    }
	
	solveProofOfWork(difficulty = 4) {
        this.nonce = 0;
        while (true) {
            this.hash = this.calculateHash();
            const valid = this.hash.slice(0, difficulty);

            if (valid === Array(difficulty + 1).join('0')) {
                console.log(this);
                return true;
            }
            this.nonce++;
        }
  }
}

var blockfromObject = (object) => {
    return new Block(
        object.index,
        object.previousHash,
        object.timestamp,
        object.data,
        object.hfile,
        object.hash,
        object.nonce
    )
}

var sockets = [];
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};

var getGenesisBlock = () => {
    return new Block(0, "0", 1465154705, "genesis block", "none", "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
};

var initHttpServer = () => {
    var app = express();
    app.use(bodyParser.json());

    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)));
    app.post('/mineBlock', (req, res) => {
        var newBlock = generateNextBlock(req.body.data);
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block ajouté : ' + JSON.stringify(newBlock));
        res.send();
    });
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, () => console.log('Écoute HTTP sur le port : ' + http_port));
};


var initP2PServer = () => {
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    console.log('Écoute du port websocket p2p sur : ' + p2p_port);

};

var initConnection = (ws) => {
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};

var initMessageHandler = (ws) => {
    ws.on('message', (data) => {
        var message = JSON.parse(data);
        console.log('Message Reçu' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
};

var initErrorHandler = (ws) => {
    var closeConnection = (ws) => {
        console.log('échec de la connexion au pair : ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws));
};


var generateNextBlock = (blockData, blockhfile) => {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nextTimestamp = new Date().getTime() / 1000;
	//var nexthfile = calculateHashFile(blockData);
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData, blockhfile);
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, blockhfile, nextHash);
};


var calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.hfile);
};

var calculateHash = (index, previousHash, timestamp, data, hfile) => {
    return CryptoJS.SHA256(index + previousHash + timestamp + data + hfile).toString();
};

var calculateHashFile = (data) => {
    return CryptoJS.SHA256(data).toString();
};

var addBlock = (newBlock) => {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
};

var isValidNewBlock = (newBlock, previousBlock) => {
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('index invalide');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('previousHash invalide');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('hash invalide: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};

var connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        var ws = new WebSocket(peer);
        ws.on('open', () => initConnection(ws));
        ws.on('error', () => {
            console.log('échec de la connexion')
        });
    });
};

var handleBlockchainResponse = (message) => {
    var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('Dernier block de la blockchain : ' + latestBlockHeld.index + '. Block reçu par le pair : ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("Nous pouvons appondre le block reçu à notre chaîne");
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            console.log("Nous devons interroger notre chaîne depuis notre pair");
            broadcast(queryAllMsg());
        } else {
            console.log("La blockchain reçue est plus longue que la blockchain actuelle");
            replaceChain(receivedBlocks);
        }
    } else {
        console.log('La blockchain reçue est plus courte que la blockchain actuelle. Ne rien faire.');
    }
};

var replaceChain = (newBlocks) => {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('La blockchain reçue est valide. Remplacer la blockchain actuelle par la blockchain reçue.');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('La blockchain reçue est invalide.');
    }
};

var isValidChain = (blockchainToValidate) => {
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

var getLatestBlock = () => blockchain[blockchain.length - 1];
var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});
var responseChainMsg = () =>({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
});

var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));


var getInitialBlockchain = () => {
    var blockchain = []

    if(!fs.existsSync(blockchainFilePath)) {
        blockchain.push(getGenesisBlock())
    }
    
    else {
        var data = fs.readFileSync(blockchainFilePath)
        var blocks = JSON.parse(data)

        blocks.forEach(object => {
            blockchain.push(blockfromObject(object))
        });
    }

    return blockchain
}

var storeBlockchain = (blockchain) => {
    var data = JSON.stringify(blockchain)
    fs.writeFileSync(blockchainFilePath, data)
}
var blockchain = getInitialBlockchain()

function handleShutdown(options) {
    storeBlockchain(blockchain)

    if(options.exit) process.exit();
}

process.on('exit', handleShutdown.bind(null, {exit:false}));
process.on('SIGINT', handleShutdown.bind(null, {exit:true}));
process.on('SIGTERM', handleShutdown.bind(null, {exit:true}));
process.on('SIGKILL', handleShutdown.bind(null, {exit:true}));


connectToPeers(initialPeers);
initHttpServer();
initP2PServer();