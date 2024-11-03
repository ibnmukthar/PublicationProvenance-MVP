import { Client } from 'pg';
import axios from 'axios';
import FormData from 'form-data';
import { createNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { createSignerFromKeypair, generateSigner, keypairIdentity, percentAmount } from '@metaplex-foundation/umi';
import { mockStorage } from '@metaplex-foundation/umi-storage-mock';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

dotenv.config();

// Configuration values (replace with your actual data)
const PINATA_API_KEY = "28387a203440412cdec5";
const PINATA_SECRET_API_KEY = "2b46d4935f0c1483fa09b5ecba06400f9227ed960d1ac109c6491e3dc5802faa";
const QUICKNODE_RPC = "https://magical-dry-firefly.solana-devnet.quiknode.pro/10dc4035aa2496d434d5e940ee695affed6da33a";
const NFT_NAME = 'Arxiv NFT';
const NFT_SYMBOL = 'ARXIV';
const secretKey = new Uint8Array([
  100, 239, 74, 145, 52, 41, 11, 63, 9, 102, 216, 200, 72, 119, 28, 86,
  15, 71, 94, 118, 24, 117, 221, 125, 134, 94, 64, 155, 65, 108, 239, 33,
  221, 146, 42, 175, 193, 104, 82, 132, 89, 54, 232, 126, 55, 3, 219, 202,
  38, 249, 247, 192, 74, 162, 184, 1, 10, 245, 191, 65, 19, 248, 189, 199
]);


const client = new Client({
    host: 'lsd.so',
    database: 'you',
    port: 5432,
});


const umi = createUmi(QUICKNODE_RPC);
const creatorWallet = umi.eddsa.createKeypairFromSecretKey(secretKey);
const creator = createSignerFromKeypair(umi, creatorWallet);
umi.use(keypairIdentity(creator));
umi.use(mplTokenMetadata());
umi.use(mockStorage());


interface ArxivPaper {
    title: string;
    authors: string;
    abstract: string;
    doi: string;
    url: string;
}


async function fetchPapers(url: string): Promise<ArxivPaper[]> {
    await client.connect();
    
    const query = `
        SELECT
            h1.title.mathjax AS title,
            div.authors AS authors,
            blockquote.abstract.mathjax AS abstract,
            a#arxiv-doi-link AS doi
        FROM
            ${url}
        GROUP BY
            div#content-inner;
    `;
    
    const papers: ArxivPaper[] = [];
    
    try {
        const res = await client.query(query);
        
        for (const row of res.rows) {
            let title = (row.title?.replace("Title:", "").trim()) || "No Title";
            let authors = (row.authors?.replace("Authors:", "").trim()) || "No Authors";
            let abstract = (row.abstract?.trim()) || "No Abstract";

            if (abstract.startsWith("Abstract:")) abstract = abstract.slice(9).trim();
            abstract = abstract.replace(/\s+/g, ' ');

            papers.push({
                title,
                authors,
                abstract,
                doi: row.doi || "No DOI",
                url,
            });
        }
    } catch (err) {
        console.error("Error fetching papers:", err);
    } finally {
        await client.end();
    }
    
    return papers;
}


interface PinataResponse {
    IpfsHash: string;
    PinSize: number;
    Timestamp: string;
}


async function uploadJsonToPinata(jsonData: string): Promise<string | null> {
    const url = "https://api.pinata.cloud/pinning/pinFileToIPFS";
    
    const formData = new FormData();
    formData.append('file', Buffer.from(jsonData), { filename: "data.json", contentType: "application/json" });

    const headers = {
        'pinata_api_key': PINATA_API_KEY,
        'pinata_secret_api_key': PINATA_SECRET_API_KEY,
        ...formData.getHeaders(),
    };

    try {
        
        const response = await axios.post<PinataResponse>(url, formData, { headers });
        if (response.status === 200) {
            const ipfsHash = response.data.IpfsHash;
            const link = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
            console.log("File uploaded successfully. Link:", link);
            return link;
        } else {
            console.error("Failed to upload file:", response.data);
            return null;
        }
    } catch (error) {
        console.error("Error uploading to Pinata:", error);
        return null;
    }
}


function abbreviate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.split(' ').slice(0, 3).join(' ').substring(0, maxLength).trim() + '...';
}




async function mintNft(metadataUri: string, paperTitle: string, authors: string) {
    try {
        const mint = generateSigner(umi);

        
        const nftName = abbreviate(paperTitle, 20);  
        const nftSymbol = authors.split(",")[0].split(" ").map(word => word[0]).join("").substring(0, 4).toUpperCase();  // First author's initials, up to 4 characters

        await createNft(umi, {
            mint,
            name: nftName,
            symbol: nftSymbol,
            uri: metadataUri,
            sellerFeeBasisPoints: percentAmount(5.5),
            creators: [{ address: creator.publicKey, verified: true, share: 100 }],
        }).sendAndConfirm(umi);

        console.log(`Created NFT: ${mint.publicKey.toString()} with name "${nftName}" and symbol "${nftSymbol}"`);

        const envFilePath = path.resolve(__dirname, '.env');
        fs.appendFileSync(envFilePath, `\nNFT_TOKEN_ADDRESS=${mint.publicKey.toString()}\n`);
        console.log(`NFT token address added to .env: ${mint.publicKey.toString()}`);
        return mint.publicKey.toString();
    } catch (e) {
        console.error("Failed to mint NFT:", e);
    }
}

// Transfer NFT to a public address
async function transferNft(mintAddress: string, recipientAddress: string) {
    try {
        const connection = new Connection(QUICKNODE_RPC, 'confirmed');
        const mintPublicKey = new PublicKey(mintAddress);
        const recipientPublicKey = new PublicKey(recipientAddress);
        const creatorPublicKey = new PublicKey(creatorWallet.publicKey.toString()); // Convert to Solana-compatible PublicKey

        // Get or create the associated token accounts for the sender and the recipient
        const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            Keypair.fromSecretKey(secretKey), // Using a Solana Keypair for the connection
            mintPublicKey,
            creatorPublicKey
        );

        const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            Keypair.fromSecretKey(secretKey),
            mintPublicKey,
            recipientPublicKey
        );

        // Create the transfer instruction
        const transferInstruction = createTransferInstruction(
            senderTokenAccount.address,
            recipientTokenAccount.address,
            creatorPublicKey,
            1, // Amount to transfer, 1 for NFT
            [],
            TOKEN_PROGRAM_ID
        );

        // Build and send the transaction
        const transaction = new Transaction().add(transferInstruction);
        const signature = await connection.sendTransaction(transaction, [Keypair.fromSecretKey(secretKey)], { skipPreflight: false, preflightCommitment: "confirmed" });

        console.log(`NFT transferred successfully. Transaction Signature: ${signature}`);
    } catch (error) {
        console.error("Error transferring NFT:", error);
    }

}


export async function main(yourUrl: string, recipientPublicKeyString: string) {
    //const yourUrl = 'https://arxiv.org/abs/2403.00578';
    //const recipientPublicKeyString = '2fQ2i4Rk9UYgSHthfWNxPscixK7xucqFYpNCUmKZkuaV';
    try {
        
        const papers = await fetchPapers(yourUrl);
        if (papers.length === 0) {
            console.log("No papers found.");
            return;
        }

        const paper = papers[0];  
        const jsonData = JSON.stringify(paper, null, 2);

        
        const ipfsLink = await uploadJsonToPinata(jsonData);
        if (!ipfsLink) {
            console.log("IPFS upload failed.");
            return;
        }
  
        const NFT_TOKEN_ADDRESS = await mintNft(ipfsLink, paper.title, paper.authors);
        if (NFT_TOKEN_ADDRESS) {
            await transferNft(NFT_TOKEN_ADDRESS, recipientPublicKeyString);
        } else {
            console.error("NFT_TOKEN_ADDRESS is undefined.");
        }
        
    } catch (error) {
        console.error("Error in main function:", error);
    }
}

//main();