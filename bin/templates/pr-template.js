"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrTemplate = buildPrTemplate;
function buildPrTemplate(input) {
    const { jira, title, description, liquibase, properties, developer, branch, environment, } = input;
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
