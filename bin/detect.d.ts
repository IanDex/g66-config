type Env = "dev" | "ci";
interface ServiceInfo {
    serviceName: string;
    branch: string;
    baseBranch: string;
    env: Env;
}
export declare function detectServiceInfo(cwd: string): Promise<ServiceInfo>;
export {};
