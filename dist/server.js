"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const mintNFT_1 = require("./mintNFT");
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Serve static files from the public directory
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// API endpoint for minting NFTs
app.post('/api/mint-nft', async (req, res) => {
    const { yourURL, recipientPublicKeyString } = req.body;
    try {
        const transaction = await (0, mintNFT_1.main)(yourURL, recipientPublicKeyString);
        res.json({ transaction });
    }
    catch (error) {
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: 'An unknown error occurred' });
        }
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
