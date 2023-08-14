import { Vector } from "@pinecone-database/pinecone";
import { PineconeClient,utils } from "@pinecone-database/pinecone";
import * as vscode from 'vscode';
import * as cohere from "cohere-ai";
export const { createIndexIfNotExists, chunkedUpsert } = utils;

;
const pineconeAPIKey: string | undefined = vscode.workspace.getConfiguration('bddgpt').get("pineconeAPIKey");
const cohereAPIKey : string | undefined = vscode.workspace.getConfiguration('bddgpt').get("cohereAPIKey");
if(cohereAPIKey){
cohere.init(cohereAPIKey);
}
const MODEL = "embed-english-v2.0";

class Embedder {
  

    // Embed a single string
    async embed(texts: string[]) {
        const embedding = await cohere.embed({
            model: MODEL,
            texts: texts,
          });
        return embedding.body.embeddings;
    }
  
    // Batch an array of string and embed each batch
    // Call onDoneBatch with the embeddings of each batch
    // async embedBatch(
    //   texts: string[],
    //   batchSize: number,
    //   onDoneBatch: (embeddings: Vector[]) => void
    // ) {
    //   const batches = sliceIntoChunks<string>(texts, batchSize);
    //   for (const batch of batches) {
    //     const embeddings = await Promise.all(
    //       batch.map((text) => this.embed(text))
    //     );
    //     onDoneBatch(embeddings);
    //   }
    // }
  }
export { Embedder };

let pineconeClient: PineconeClient | null = null;

// Returns a Promise that resolves to a PineconeClient instance
export const getPineconeClient = async (): Promise<PineconeClient> => {

  if (pineconeClient) {
    return pineconeClient;
  } else {
    pineconeClient = new PineconeClient();

    if(pineconeAPIKey){
    await pineconeClient.init({
      apiKey: pineconeAPIKey,
      environment: "us-west1-gcp"
    });
  }
  }
  return pineconeClient;
};



