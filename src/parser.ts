import { Uri } from "vscode";

export class Parser{
    tokens: Map<string,[Uri,number]>;

    constructor()
    {
        this.tokens = new Map<string,[Uri,number]>();
    }

    BDDParser(text: string, uri: Uri){
        const regexPattern: RegExp = /(?:@step|@given|@then|@when|@and|@but|@Given|@Then|@When|@And|@But|@Step)/;
        let textByLine = text.split("\n");
        let lineNumber = 1;
        for(let line of textByLine)
        {
            if(regexPattern.test(line)){
                let BDDStep = line.substring(line.indexOf("(")+1,line.lastIndexOf(")"));
                const cleanedBDDStep = BDDStep.replace(/[^a-zA-Z0-9 _]/g, '');
                this.tokens.set(cleanedBDDStep,[uri, lineNumber]);
            }
            lineNumber++;
        }

    }
}