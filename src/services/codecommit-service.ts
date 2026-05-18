import {
  CodeCommitClient,
  CreatePullRequestCommand,
  CreatePullRequestCommandOutput,
  GetPullRequestCommand,
  GetPullRequestCommandOutput,
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

export interface PullRequestTargetMeta {
  repositoryName: string;
  sourceReference: string;
  destinationReference: string;
  sourceCommit: string;
  destinationCommit: string;
}

export interface PullRequestDetails {
  pullRequestId: string;
  title: string;
  status: string;
  targets: PullRequestTargetMeta[];
}

export async function getPullRequestDetails(
  pullRequestId: string,
): Promise<PullRequestDetails> {
  const command = new GetPullRequestCommand({ pullRequestId });
  let result: GetPullRequestCommandOutput;
  try {
    result = await client.send(command);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo leer el PR en CodeCommit: ${msg}`);
  }

  const pr = result.pullRequest;
  if (!pr?.pullRequestId) {
    throw new Error("Respuesta de CodeCommit sin datos del PR.");
  }

  const targets: PullRequestTargetMeta[] = (pr.pullRequestTargets ?? []).map(
    (t) => ({
      repositoryName: t.repositoryName ?? "",
      sourceReference: t.sourceReference ?? "",
      destinationReference: t.destinationReference ?? "",
      sourceCommit: t.sourceCommit ?? "",
      destinationCommit: t.destinationCommit ?? "",
    }),
  );

  return {
    pullRequestId: pr.pullRequestId,
    title: pr.title ?? "",
    status: pr.pullRequestStatus ?? "",
    targets,
  };
}