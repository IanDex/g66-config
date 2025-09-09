"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptPrData = promptPrData;
const inquirer_1 = __importDefault(require("inquirer"));
async function promptPrData(devConfig) {
    console.log(`👤 Encargado: ${devConfig.author} (desde .g66config.json)`);
    const answers = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'jira',
            message: '🔗 ID de la historia de Jira (ej: HU-123):',
            validate: input => input.trim() !== '' || 'Este campo es obligatorio',
        },
        {
            type: 'input',
            name: 'title',
            message: '📝 Título del Pull Request:',
            validate: input => input.trim() !== '' || 'Este campo es obligatorio',
        },
        {
            type: 'editor',
            name: 'description',
            message: '📄 Descripción del PR (se abrirá un editor):',
        },
        {
            type: 'confirm',
            name: 'addLiquibase',
            message: '➕ ¿Deseas agregar fragmento Liquibase?',
            default: false,
        },
        {
            type: 'editor',
            name: 'liquibase',
            message: '✏️  Pega aquí el bloque Liquibase:',
            when: (answers) => answers.addLiquibase,
        },
        {
            type: 'confirm',
            name: 'addProperties',
            message: '➕ ¿Deseas agregar fragmento de propiedades YAML?',
            default: false,
        },
        {
            type: 'editor',
            name: 'properties',
            message: '✏️  Pega aquí el bloque YAML de propiedades:',
            when: (answers) => answers.addProperties,
        },
    ]);
    return {
        jira: answers.jira,
        title: answers.title,
        description: answers.description || '',
        liquibase: answers.liquibase || '',
        properties: answers.properties || '',
    };
}
