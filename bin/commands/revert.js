"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revertConfig = revertConfig;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const detect_1 = require("../detect");
async function revertConfig() {
    const cwd = process.cwd();
    const { env } = await (0, detect_1.detectServiceInfo)(cwd);
    const fileToRevert = path_1.default.join(cwd, "src", "main", "resources", `application-${env}.yml`);
    try {
        (0, child_process_1.execSync)(`git checkout -- "${fileToRevert}"`, { stdio: "inherit" });
        console.log(chalk_1.default.green(`\n✅ Archivo restaurado: ${fileToRevert}`));
    }
    catch (error) {
        console.error(chalk_1.default.red("\n❌ Error al intentar revertir el archivo."));
        console.error(error);
    }
}
