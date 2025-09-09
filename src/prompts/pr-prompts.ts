import inquirer from 'inquirer';
import { DeveloperConfig } from '../utils/config-utils';

export interface PrPromptData {
  jira: string;
  title: string;
  description: string;
  liquibase: string;
  properties: string;
}

export async function promptPrData(devConfig: DeveloperConfig): Promise<PrPromptData> {
  console.log(`👤 Encargado: ${devConfig.author} (desde .g66config.json)`);

  const answers = await inquirer.prompt([
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
