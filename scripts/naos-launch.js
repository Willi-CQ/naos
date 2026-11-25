// What the NAOS shortcut runs, under wscript, in JScript. wscript has no console, and window style 0 hides the one node would get.
// `naos open` reports its own failures and exits with 3. Anything else means node never got that far, so only this script can say so.
var shell = new ActiveXObject('WScript.Shell');
var files = new ActiveXObject('Scripting.FileSystemObject');
var repo = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName));
var node = WScript.Arguments.length > 0 ? WScript.Arguments(0) : 'node';
var cli = files.BuildPath(repo, 'packages\\kernel\\src\\cli.ts');

// Run expands %VAR% in its command, once, so the paths travel in the environment and a % in one of them stays what it is.
var env = shell.Environment('Process');
env('NAOS_NODE') = node;
env('NAOS_CLI') = cli;

shell.CurrentDirectory = repo;
var code;
try {
  code = shell.Run('"%NAOS_NODE%" --disable-warning=ExperimentalWarning "%NAOS_CLI%" open', 0, true);
} catch (error) {
  code = -1;
}

if (code === -1) WScript.Echo('NAOS could not find Node at ' + node + '. Run npm run shortcut again in ' + repo + '.');
else if (code !== 0 && code !== 3) WScript.Echo('NAOS could not start. Run npm install in ' + repo + ', then try again.');
WScript.Quit(code);
