"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPullRequest = createPullRequest;
exports.createSimplePullRequest = createSimplePullRequest;
const client_codecommit_1 = require("@aws-sdk/client-codecommit");
const open_1 = __importDefault(require("open"));
const client = new client_codecommit_1.CodeCommitClient({ region: 'us-east-1' });
async function createPullRequest(options) {
    const { repositoryName, sourceBranch, destinationBranch, title, description } = options;
    const command = new client_codecommit_1.CreatePullRequestCommand({
        title,
        description,
        targets: [
            {
                repositoryName,
                sourceReference: sourceBranch,
                destinationReference: destinationBranch,
            },
        ],
    });
    let result;
    try {
        result = await client.send(command);
    }
    catch (err) {
        throw new Error(`❌ Error al crear el PR en AWS CodeCommit: ${err}`);
    }
    const prId = result.pullRequest?.pullRequestId;
    if (!prId) {
        console.warn('⚠️ PR creado, pero no se pudo obtener el ID.');
        return;
    }
    const prUrl = `https://console.aws.amazon.com/codesuite/codecommit/repositories/${repositoryName}/pull-requests/${prId}/changes?region=us-east-1`;
    console.log(`\n✅ Pull Request creado con éxito:`);
    console.log(prUrl);
    // Abrir el navegador automáticamente
    await (0, open_1.default)(prUrl);
}
async function createSimplePullRequest(repositoryName, sourceBranch, destinationBranch, title) {
    return createPullRequest({
        repositoryName,
        sourceBranch,
        destinationBranch,
        title,
        description: "", // sin descripción
    });
}
