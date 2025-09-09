import { PrPromptData } from '../prompts/pr-prompts';

interface TemplateInput extends PrPromptData {
  developer: string;
  branch: string;
  environment: 'dev' | 'ci';
}

export function buildPrTemplate(input: TemplateInput): string {
  const {
    jira,
    title,
    description,
    liquibase,
    properties,
    developer,
    branch,
    environment,
  } = input;

  return `### 🔧 Historia

- Jira: [${jira}](https://jira.global66.com/browse/${jira})
- Encargado: ${developer}

---

### 📝 Descripción

 ´´´
 ${description || '_Sin descripción._'}
 ´´´

---

### 📦 Cambios Técnicos

${properties ? '```yaml\n# 📁 Propiedades\n' + properties.trim() + '\n```' : '_Sin propiedades._'}

${liquibase ? '```yaml\n# 🧪 Liquibase\n' + liquibase.trim() + '\n```' : '_Sin fragmentos Liquibase._'}

`;
}
