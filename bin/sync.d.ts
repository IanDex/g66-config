interface SyncParams {
    configRepoPath: string;
    serviceName: string;
    env: "dev" | "ci";
    cwd: string;
}
export declare function syncConfigFile({ configRepoPath, serviceName, env, cwd }: SyncParams): Promise<void>;
export {};
