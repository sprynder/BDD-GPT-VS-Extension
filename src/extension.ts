// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Parser } from './parser';
import { getPineconeClient, createIndexIfNotExists, chunkedUpsert, Embedder } from "./pinecone";
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "bddgpt" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('bddgpt.search', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		const panel = vscode.window.createWebviewPanel(
			'searchView', // Identifies the type of the webview. Used internally
			'BDD Semantic Search', // Title of the panel displayed to the user
			vscode.ViewColumn.One, // Editor column to show the new webview panel in.
			{} // Webview options. More on these later.
		);

		panel.webview.html = getWebviewContent();

		panel.onDidDispose(
			() => {
				// When the panel is closed, cancel any future updates to the webview content
			},
			null,
			context.subscriptions
		);
	});

	let search = vscode.commands.registerCommand('bddgpt.scan', () => {
		// const wsedit = new vscode.WorkspaceEdit();

		let temp = vscode.workspace.workspaceFolders;
		let uriList: vscode.Uri[] = [];
		if (temp) {

			let rootUri = temp[0].uri;
			const wsPath = rootUri.fsPath;
			// const filePath = vscode.Uri.file(wsPath + '/BDD.json');
			let fileParser = new Parser();
			// vscode.workspace.applyEdit(wsedit);
			findFiles(rootUri, uriList).then(async (res) => {
				for (let uri of uriList) {
					await vscode.workspace.openTextDocument(uri).then((document) => {
						let text = document.getText();
						fileParser.BDDParser(text, uri);
					});
				}
			}).then(async () => {
				//Have all BDD steps
				//Now to vectorize them all and send them to PineCone API, and store them in locla
				console.log(fileParser.tokens);
				await context.workspaceState.update("tokens", fileParser.tokens);
			}).then(async () => {
				const indexName = "bdd-gpt";
				let counter = 0;
				let BDDSteps = Array.from(fileParser.tokens.keys());
				const embedder = new Embedder();
				const pineconeClient = await getPineconeClient();
				await createIndexIfNotExists(pineconeClient, indexName, 4096);
				const index = pineconeClient.Index(indexName);
				// Start the batch embedding process
				let temp = await embedder.embed(BDDSteps)
				await Promise.all(temp.map((curVec,i) =>{
					index.upsert({
						upsertRequest: {
							vectors: [{id: BDDSteps[i],
								values: curVec}]
						}
					});
				}));

				let queryEmbedding = await embedder.embed(["cookies are not cleared after opening product page"]);
				console.log(queryEmbedding[0]);
				const results = await index.query({
					queryRequest: {
						vector: queryEmbedding[0],
						topK: 5,
						includeValues: true,
					},

				})
				console.log(results)
			});

		}
	});

	async function findFiles(rootUri: vscode.Uri, uriList: vscode.Uri[]) {
		let directoryResult = await vscode.workspace.fs.readDirectory(rootUri)
		for (let node of directoryResult) {
			let newUri = vscode.Uri.joinPath(rootUri, node[0]);
			if (node[1] === 2) {
				await findFiles(newUri, uriList);
			}
			else {
				let fileExtension = newUri.path.substring(newUri.path.indexOf("."));
				let validExtensions = [".py", ".java"]
				if (validExtensions.includes(fileExtension)) {
					uriList.push(newUri);
				}
			}
		}

	}

	context.subscriptions.push(disposable);
	context.subscriptions.push(search);


}

function getWebviewContent() {
	return `<!DOCTYPE html>
  <html lang="en">
  <head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <title>BDD Semantic Search</title>
  </head>
  <body>
  <input>
  </input>
  </body>
  </html>`;
}

// This method is called when your extension is deactivated
export function deactivate() { }
