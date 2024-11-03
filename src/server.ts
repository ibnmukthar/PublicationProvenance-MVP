import express from 'express';
import path from 'path';
import { main } from './mintNFT';

const app = express();
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// API endpoint for minting NFTs
app.post('/api/mint-nft', async (req, res) => {
    const { yourURL, recipientPublicKeyString } = req.body;
    
    try {
        const transaction = await main(yourURL, recipientPublicKeyString);
        res.json({ transaction });
    } catch (error) {
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'An unknown error occurred' });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
