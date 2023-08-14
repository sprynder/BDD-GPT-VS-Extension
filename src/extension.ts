// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Parser } from './parser';
import { getPineconeClient, createIndexIfNotExists, chunkedUpsert, Embedder } from "./pinecone";
import { QueryResponse, VectorOperationsApi } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch';
//import { SearchPanel } from './panels/search';
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
let scanFlag = false;
export function activate(context: vscode.ExtensionContext) {
	let currentPanel: vscode.WebviewPanel | undefined = undefined;
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "bddgpt" is now active!');
	const embedder = new Embedder();
	let index: VectorOperationsApi | undefined = undefined;
	let fileParser = new Parser();
	startClient();
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('bddgpt.search', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		if (currentPanel) {
			currentPanel.reveal(vscode.ViewColumn.One);
		} else {
			currentPanel = vscode.window.createWebviewPanel(
				'BDDGPT',
				'BDD Semantic Search',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					enableCommandUris: true
				}
			);
			currentPanel.webview.html = getWebviewContent();
			let options : QueryResponse | undefined = undefined;
			currentPanel.webview.onDidReceiveMessage(
				message => {
					switch (message.command) {
						case 'query':
							if(scanFlag){
							vscode.window.showInformationMessage("Starting search for BDD steps!");
							searchQuery(message.text).then(async (results) => {
								//create HTML to display results
								//set currentPanel.webview.html = new html;
								options = results;
								if (currentPanel && results) {
									let newHTML = await createHTML(results, currentPanel);
									currentPanel.webview.html = newHTML;
									vscode.window.showInformationMessage("Results found!");
								}

							});
							return;
						}
						else{
							vscode.window.showInformationMessage("Scan has not been run. Please run a scan first before searching!");
						}
						case 'open':
							openFiles(message.text, options);					
					}
				},
				undefined,
				context.subscriptions
			);



			currentPanel.onDidDispose(
				() => {
					currentPanel = undefined;
				},
				undefined,
				context.subscriptions
			);
		}

	});

	let search = vscode.commands.registerCommand('bddgpt.scan', () => {
		// const wsedit = new vscode.WorkspaceEdit();
		
		if (index === undefined) {
			vscode.window.showInformationMessage("Client is still setting up! Please wait a moment as it finished initializing.");
			return;
		}
		vscode.window.showInformationMessage("Starting to scan all files for BDD steps!");
		let temp = vscode.workspace.workspaceFolders;
		let uriList: vscode.Uri[] = [];
		if (temp) {

			let rootUri = temp[0].uri;
			const wsPath = rootUri.fsPath;
			// const filePath = vscode.Uri.file(wsPath + '/BDD.json');

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
				await context.workspaceState.update("tokens", fileParser.tokens);
			}).then(async () => {
				let BDDSteps = Array.from(fileParser.tokens.keys());
				const indexName = "bdd-gpt";
				const pineconeClient = await getPineconeClient();
				await createIndexIfNotExists(pineconeClient, indexName, 4096);
				index = pineconeClient.Index(indexName);
				// Start the batch embedding process
				let temp = await embedder.embed(BDDSteps)
				await Promise.all(temp.map((curVec, i) => {
					index?.upsert({
						upsertRequest: {
							vectors: [{
								id: BDDSteps[i],
								values: curVec
							}]
						}
					});
				}));
				vscode.window.showInformationMessage("Finished scanning all files! You can now search for BDD steps!");
				scanFlag=true;
			});
		}
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(search);

	async function openFiles(buttonID: string, options :QueryResponse | undefined)
	{	let pos = Number(buttonID)
		let map: Map<string, [vscode.Uri, number]> | undefined = await context.workspaceState.get("tokens");
		if (map) {
			if(options && options.matches){
				let curURI = map.get(options.matches[pos].id);
				if(curURI){
					let lineNumber = new vscode.Position(curURI[1],0);
					let tempNum = curURI[1];
					vscode.workspace.openTextDocument(curURI[0]).then((doc)=>{
						vscode.window.showTextDocument(doc).then((editor)=>{
							editor.selections = [new vscode.Selection(lineNumber,lineNumber)];
							let range = new vscode.Range(new vscode.Position(tempNum+15,0),lineNumber);
							editor.revealRange(range);
						});
					});
				}
			}
		}
						
	}

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

	async function startClient() {
		const indexName = "bdd-gpt";
		const pineconeClient = await getPineconeClient();
		await createIndexIfNotExists(pineconeClient, indexName, 4096);
		index = pineconeClient.Index(indexName);
		vscode.window.showInformationMessage("BDDGPT Client has finished loading! You can now run scan and search commands!");
	}

	async function searchQuery(query: string) {
		if (index === undefined) {
			vscode.window.showInformationMessage("Client is still loading!");
			return;
		}
		let queryEmbedding = await embedder.embed([query]);
		const results = await index?.query({
			queryRequest: {
				vector: queryEmbedding[0],
				topK: 5,
				includeValues: true,
			},

		})
		return results;
	}

	async function createHTML(results: QueryResponse, panel: vscode.WebviewPanel) {
		if (results.matches) {
			let newHTML = `
		<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Cat Coding</title>
	</head>
	<body>
		<input id="input">Search for BDD Steps</input>
		<button id="submit" onclick = "getInputValue();">Search!</button>
		<script>
		const vscode = acquireVsCodeApi();
		function openStepFile(val)
		{
			console.log(val);
			vscode.postMessage({command: 'open', text: val});
		}
		function getInputValue(){
			
			const text = document.getElementById('input').value;
			vscode.postMessage({command: 'query', text: text});
			console.log(text);
		}
		</script>
		`;
			let map: Map<string, [vscode.Uri, number]> | undefined = await context.workspaceState.get("tokens");
			if (map) {
				for (let i = 0; i < results.matches.length; i++) {
					let curStep = results.matches[i].id;
					let curScore = results.matches[i].score;
					let curURI = map.get(curStep);
					if(curURI){
						let webURI = panel.webview.asWebviewUri(curURI[0]);
						let curLinePosition = fileParser.tokens.get("curStep")?.[1];
						newHTML +="<div><a>" + curStep +  "</a><button value ="+i+' onclick = "openStepFile(this.value);">Open File</button></div>\n';
					}
				}
			}
			else {
				return "ERROR";
			}
			newHTML += `
		</body>
		</html>`;		
			return newHTML;
		}
		else {
			return "ERROR";
		}
	}

}


function getWebviewContent() {
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Cat Coding</title>
	</head>
	<body>
		<input id="input">Search for BDD Steps</input>
		<button id="submit" onclick = "getInputValue();">Search!</button>
		<script>
		const vscode = acquireVsCodeApi();
		function getInputValue(){
			
			const text = document.getElementById('input').value;
			vscode.postMessage({command: 'query', text: text});
			console.log(text);
		}
			
		</script>
	</body>
	</html>`;
}

// This method is called when your extension is deactivated
export function deactivate() { }

