import {
  CodeCommitClient,
  CreatePullRequestCommand,
  CreatePullRequestCommandOutput,
} from '@aws-sdk/client-codecommit';
import open from 'open';

const client = new CodeCommitClient({ region: 'us-east-1' });

interface CreatePrOptions {
  repositoryName: string;
  sourceBranch: string;
  destinationBranch: string;
  title: string;
  description: string;
}

export async function createPullRequest(options: CreatePrOptions): Promise<void> {
  const { repositoryName, sourceBranch, destinationBranch, title, description } = options;

  const command = new CreatePullRequestCommand({
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

  let result: CreatePullRequestCommandOutput;

  try {
    result = await client.send(command);
  } catch (err) {
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
  await open(prUrl);
}

export async function createSimplePullRequest(
  repositoryName: string,
  sourceBranch: string,
  destinationBranch: string,
  title: string
): Promise<void> {
  return createPullRequest({
    repositoryName,
    sourceBranch,
    destinationBranch,
    title,
    description: "", // sin descripción
  });
}