"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ship = ship;
const child_process_1 = require("child_process");
const chalk_1 = __importDefault(require("chalk"));
const inquirer_1 = __importDefault(require("inquirer"));
async function ship() {
    const { hu, desc } = await inquirer_1.default.prompt([
        {
            type: "input",
            name: "hu",
            message: chalk_1.default.blue("🔖 Ingresa el código de la HU (ej: ACME-123):"),
            validate: (input) => input.trim() !== "" || "El código de la HU no puede estar vacío",
        },
        {
            type: "input",
            name: "desc",
            message: chalk_1.default.blue("✏️  Ingresa una descripción corta del cambio:"),
            validate: (input) => input.trim() !== "" || "La descripción no puede estar vacía",
        },
    ]);
    try {
        console.log(chalk_1.default.yellow("\n🚀 Revirtiendo cambios en el archivo de configuración..."));
        (0, child_process_1.execSync)("g66 revert", { stdio: "inherit" });
        console.log(chalk_1.default.yellow("\n🧹 Ejecutando spotless..."));
        (0, child_process_1.execSync)("mvn spotless:apply", { stdio: "inherit" });
        console.log(chalk_1.default.yellow("\n📦 Haciendo commit..."));
        (0, child_process_1.execSync)("git add .", { stdio: "inherit" });
        (0, child_process_1.execSync)(`git commit -m "[${hu}] ${desc}"`, { stdio: "inherit" });
        console.log(chalk_1.default.yellow("\n📤 Haciendo push..."));
        (0, child_process_1.execSync)("git push", { stdio: "inherit" });
        console.log(chalk_1.default.green("\n✅ ¡Código enviado correctamente!"));
    }
    catch (error) {
        console.error(chalk_1.default.red("\n❌ Error al ejecutar el proceso automático."));
    }
}
