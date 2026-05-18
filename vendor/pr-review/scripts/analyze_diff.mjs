#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Usage: analyze_diff.mjs <diff-file-or-dir>");
  process.exit(2);
}

async function readInputs(input) {
  const stat = await fs.stat(input);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(input, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(input, entry.name);
      if (entry.isFile() && /\.(diff|patch|txt)$/i.test(entry.name)) {
        files.push({ filePath: fullPath, content: await fs.readFile(fullPath, "utf8") });
      }
    }
    return files;
  }
  return [{ filePath: input, content: await fs.readFile(input, "utf8") }];
}

function lineNumber(content, index) {
  return content.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function severity(type) {
  if (type === "sql-full-scan" || type === "sql-missing-index" || type === "semantic-enum-duplication") return "high";
  if (type === "wildcard-import" || type === "jpa-query" || type === "post-mapping-mutation" || type === "endpoint-naming" || type === "service-naming" || type === "inline-test-data" || type === "test-setter" || type === "hardcoded-test-mock-data") return "medium";
  return "low";
}

function confidence(type) {
  return {
    "wildcard-import": 0.95,
    "jpa-query": 0.85,
    "sql-full-scan": 0.86,
    "sql-missing-index": 0.86,
    "semantic-enum-duplication": 0.84,
    "post-mapping-mutation": 0.8,
    "endpoint-naming": 0.72,
    "service-naming": 0.76,
    "inline-test-data": 0.78,
    "test-setter": 0.88,
    "hardcoded-test-mock-data": 0.74,
    "boolean-false-equals": 0.9,
    "suspicious-pattern": 0.8
  }[type] ?? 0.7;
}

function suggestion(type, evidence) {
  return {
    "wildcard-import": "Reemplazar el import wildcard por imports explicitos.",
    "jpa-query": "Validar plan de ejecucion, parametros, paginacion e indices antes de aprobar.",
    "sql-full-scan": "Adjuntar o revisar EXPLAIN real y ajustar indices, predicados o paginacion.",
    "sql-missing-index": "Agregar o validar indices para las columnas de filtrado y joins.",
    "semantic-enum-duplication": "Usar siempre el enum o constante tipada en lugar de strings hardcodeados.",
    "post-mapping-mutation": "Mover la transformacion al mapper, a un enrichment explicito o a una capa de dominio.",
    "endpoint-naming": `Simplificar el path; evaluar alternativas como ${endpointSuggestions(evidence).join(", ")}.`,
    "service-naming": `Renombrar para expresar responsabilidad de negocio. Alternativas: ${serviceNameSuggestions(evidence).join(", ")}.`,
    "inline-test-data": "Mover la data a fixtures JSON. Evitar setters en tests; cargar el DTO/request desde JSON para reutilizar escenarios.",
    "test-setter": "Eliminar setters en la clase test. Cargar el objeto desde un JSON fixture o centralizar la construccion fuera del test.",
    "hardcoded-test-mock-data": "Mover este dato mock a un JSON fixture versionado junto al test. El test debe leer el payload esperado desde JSON.",
    "boolean-false-equals": "Usar !valor cuando sea boolean primitivo, o manejar null explicitamente si es Boolean.",
    "suspicious-pattern": "Remover trazas temporales o reemplazarlas por logging estructurado."
  }[type] ?? "Revisar el codigo contra el lineamiento y ajustar la implementacion.";
}

function finding(type, filePath, line, evidence, message) {
  const comment = prComment(type, evidence, message);
  return {
    type,
    severity: severity(type),
    confidence: confidence(type),
    filePath,
    line,
    isPrLine: true,
    evidence: evidence.trim().slice(0, 500),
    message,
    comment,
    suggestion: suggestion(type, evidence)
  };
}

function prComment(type, evidence, message) {
  return {
    "wildcard-import": "Evitaria este import wildcard. Hace menos claro que dependencias usa realmente la clase y puede ocultar colisiones cuando el archivo crezca.",
    "jpa-query": "Esta query nueva merece revision explicita de plan de ejecucion, parametros e indices. Si queda en el PR, agregaria evidencia del EXPLAIN o ajustaria el repository para reducir riesgo de performance.",
    "sql-full-scan": "El SELECT agregado parece terminar en full scan con el EXPLAIN simulado. Antes de aprobar, validaria un EXPLAIN real y el indice que soporta el filtro.",
    "sql-missing-index": "No se ve un indice claro soportando esta query. Para evitar degradacion en tablas grandes, dejaria el indice esperado o ajustaria el predicado.",
    "semantic-enum-duplication": "Aqui se mezcla un valor hardcodeado con semantica de enum/constante. Eso tiende a duplicar reglas de negocio y rompe facil cuando cambia el enum; usaria el tipo fuerte en todo el flujo.",
    "post-mapping-mutation": "Esta mutacion despues del mapper es una senal de logica oculta. Si el DTO necesita esa transformacion, deberia vivir en el mapper, en un enrichment nombrado o en la capa de dominio.",
    "endpoint-naming": "El nombre del endpoint se lee largo o redundante. Lo simplificaria para que el recurso sea mas natural y consistente con los lineamientos de APIs.",
    "service-naming": "El nombre del servicio no deja clara una responsabilidad de negocio especifica. Como reviewer pediria un nombre mas intencional antes de aprobar.",
    "inline-test-data": "Este test esta construyendo data inline. Para mantener escenarios reutilizables y cercanos a payloads reales, la data mock deberia vivir en JSON y no en setters dentro del test.",
    "test-setter": "Evitaria setters dentro de la clase test. Este setup queda acoplado al DTO y hace dificil reutilizar o auditar la data; el objeto deberia cargarse desde un fixture JSON.",
    "hardcoded-test-mock-data": "Este literal parece data mock quemada en el test. La regla deberia ser que los datos de prueba vivan en JSON fixtures para que el caso sea legible, reusable y comparable contra payloads reales.",
    "boolean-false-equals": "Este Boolean.FALSE.equals agrega ruido si el valor no necesita null-safety especial. Usaria una expresion booleana mas directa o haria explicito el manejo de null.",
    "suspicious-pattern": "Este patron parece temporal o de debugging. Lo removeria o lo llevaria a logging estructurado antes de mergear."
  }[type] ?? message;
}

function endpointSuggestions(endpoint) {
  if (/identification-document-types/i.test(endpoint)) {
    return [endpoint.replace(/identification-document-types/i, "identification-doc-types"), "/document-types"];
  }
  const last = endpoint.split("/").filter(Boolean).at(-1) || endpoint;
  return [`/${last.replace(/identification-/i, "").replace(/document-types/i, "doc-types")}`, `/${last}`];
}

function serviceNameSuggestions(evidence) {
  const match = evidence.match(/\b(class|interface)\s+([A-Z][A-Za-z0-9_]*(?:Service|Manager|Helper|Util|Impl))\b|\b([A-Z][A-Za-z0-9_]*(?:Service|Manager|Helper|Util|Impl))\s+\w+\s*[;=]/);
  const name = match?.[2] || match?.[3] || "Service";
  const base = name
    .replace(/Impl$/, "")
    .replace(/Manager$/, "Service")
    .replace(/Helper$/, "Support")
    .replace(/Util$/, "Policy")
    .replace(/Common/, "Shared");
  return [...new Set([
    base,
    base.replace(/Service$/, "UseCase"),
    base.replace(/Service$/, "Resolver")
  ])].filter((item) => item && item !== name).slice(0, 3);
}

function serviceNameSmell(text) {
  const match = text.match(/\b(class|interface)\s+([A-Z][A-Za-z0-9_]*(?:Service|Manager|Helper|Util|Impl))\b|\b([A-Z][A-Za-z0-9_]*(?:Service|Manager|Helper|Util|Impl))\s+\w+\s*[;=]/);
  const name = match?.[2] || match?.[3];
  if (!name) return false;
  return /(Manager|Helper|Util|Common|Impl)$/.test(name) || /([A-Z][a-z]+).*\1/.test(name);
}

function detectEndpoint(text) {
  const annotation = text.match(/@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
  if (annotation) return annotation[2];
  return text.match(/["'](\/[a-zA-Z0-9_{}\/.-]{12,})["']/)?.[1] ?? null;
}

function endpointSmells(endpoint) {
  const last = endpoint.split("/").filter(Boolean).at(-1) || "";
  const words = last.split("-");
  return endpoint.length > 45 || words.length >= 4 || /identification-document-types/i.test(endpoint);
}

const findings = [];
for (const input of await readInputs(path.resolve(target))) {
  const content = input.content;
  const addedLines = parseAddedLines(content, input.filePath);
  const addedContent = addedLines.map((line) => line.text.slice(1)).join("\n");
  const enumValues = new Set([...content.matchAll(/\b[A-Z][A-Za-z0-9_]*\s*\.\s*([A-Z][A-Z0-9_]{1,})\b/g)].map((match) => match[1]));
  const mappedDtos = new Map();
  const testObjects = new Map();

  for (const line of addedLines) {
    const text = line.text.slice(1);
    if (/^\s*import\s+.*\.\*\s*;?\s*$/.test(text)) {
      findings.push(finding("wildcard-import", line.filePath, line.line, text, "Import wildcard detectado"));
    }
    if (/@Query\b/.test(text)) {
      findings.push(finding("jpa-query", line.filePath, line.line, text, "Query JPA agregada o modificada"));
    }
    if (/\b(TODO|FIXME|System\.out\.println|printStackTrace|Thread\.sleep)\b/.test(text)) {
      findings.push(finding("suspicious-pattern", line.filePath, line.line, text, "Patron sospechoso detectado"));
    }

    const stringEnum = text.match(/["']([A-Z][A-Z0-9_]{1,})["']/)?.[1];
    if (stringEnum && (enumValues.has(stringEnum) || /["'][A-Z][A-Z0-9_]{1,}["']\s*\.equals\s*\(/.test(text) || /\b(docType|documentType|type|status|state|code)\b/i.test(text))) {
      findings.push(finding("semantic-enum-duplication", line.filePath, line.line, text, `String hardcodeado duplica semantica de enum/constante (${stringEnum})`));
    }

    if (/\bBoolean\s*\.\s*FALSE\s*\.\s*equals\s*\(/.test(text)) {
      findings.push(finding("boolean-false-equals", line.filePath, line.line, text, "Uso innecesario de Boolean.FALSE.equals"));
    }

    const endpoint = detectEndpoint(text);
    if (endpoint && endpointSmells(endpoint)) {
      findings.push(finding("endpoint-naming", line.filePath, line.line, endpoint, "Endpoint largo, redundante o poco intuitivo"));
    }

    if (serviceNameSmell(text)) {
      findings.push(finding("service-naming", line.filePath, line.line, text, "Nombre de servicio/clase poco expresivo o generico"));
    }

    const mapped = text.match(/\b(?:var|[\w<>]+Dto)\s+(\w+)\s*=\s*.*\bmapper\.\w+\s*\(/i) || text.match(/\b(\w+)\s*=\s*.*\bmapper\.\w+\s*\(/i);
    if (mapped) mappedDtos.set(mapped[1], line.line);
    for (const [variable, mappedLine] of mappedDtos) {
      if (line.line > mappedLine && new RegExp(`\\b${variable}\\.set[A-Z]\\w*\\s*\\(`).test(text)) {
        findings.push(finding("post-mapping-mutation", line.filePath, line.line, text, "Mutacion de DTO despues del mapper"));
      }
    }

    if (/(test|spec)|src[\\/]+test/i.test(line.filePath)) {
      const objectCreation = text.match(/\b(\w+)\s+(\w+)\s*=\s*new\s+\w*(Dto|Request|Response|Entity|Model)\s*\(/);
      if (objectCreation) testObjects.set(objectCreation[2], { line: line.line, setters: 0, evidence: text });
      const hasTestSetter = /\.\s*set[A-Z]\w*\s*\(/.test(text);
      if (hasTestSetter) {
        findings.push(finding("test-setter", line.filePath, line.line, text, "Setter usado dentro de clase test"));
      }
      if (!hasTestSetter && isHardcodedTestMockData(text)) {
        findings.push(finding("hardcoded-test-mock-data", line.filePath, line.line, text, "Data mock hardcodeada dentro de clase test"));
      }
      for (const [name, state] of testObjects) {
        if (new RegExp(`\\b${name}\\.set[A-Z]\\w*\\s*\\(`).test(text)) state.setters += 1;
        if (state.setters >= 3) {
          findings.push(finding("inline-test-data", line.filePath, state.line, `${state.evidence} ... ${state.setters} setters`, "Test con data inline y multiples setters"));
          testObjects.delete(name);
        }
      }
    }
  }

  for (const match of addedContent.matchAll(/\bSELECT\b[\s\S]*?(?:;|$)/gi)) {
    const query = match[0].trim();
    if (!query) continue;
    const hasIndexedPredicate = /\b(id|uuid|code|codigo|reference|number)\b\s*=/i.test(query);
    const queryLine = addedLines.find((line) => line.text.includes(query.split(/\r?\n/)[0]))?.line ?? lineNumber(addedContent, match.index ?? 0);
    const queryFile = addedLines.find((line) => line.text.includes(query.split(/\r?\n/)[0]))?.filePath ?? input.filePath;
    const type = hasIndexedPredicate ? "sql-query" : "sql-full-scan";
    findings.push(finding(type, queryFile, queryLine, query, hasIndexedPredicate ? "Query SQL detectada" : "EXPLAIN simulado sugiere full table scan"));
    if (!hasIndexedPredicate) {
      findings.push(finding("sql-missing-index", queryFile, queryLine, query, "EXPLAIN simulado no detecta indice usado"));
    }
  }
}

function isHardcodedTestMockData(text) {
  if (/assert(Equals|That|True|False|Null|NotNull)\s*\(/.test(text)) return false;
  if (/^\s*(private|public|protected)?\s*static\s+final\b/.test(text)) return false;
  if (!/(Dto|Request|Response|Entity|Model|mock|Mock|fixture|expected|Expected|request|response|dto|entity)/.test(text)) return false;
  return /["'][A-Za-z0-9_ -]{2,}["']|\b\d{2,}\b|\b(true|false)\b/.test(text);
}

console.log(JSON.stringify({ findings: findings.filter((finding) => finding.isPrLine) }, null, 2));

function parseAddedLines(content, fallbackPath) {
  const result = [];
  let currentPath = fallbackPath;
  let newLine = 0;

  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    if (raw.startsWith("+++ ")) {
      currentPath = raw.replace(/^\+\+\+\s+b\//, "").replace(/^\+\+\+\s+/, "").trim() || fallbackPath;
      continue;
    }

    const hunk = raw.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      newLine = Number(hunk[1]) - 1;
      continue;
    }

    if (raw.startsWith("+")) {
      newLine += 1;
      result.push({ text: raw, line: newLine || index + 1, filePath: currentPath });
      continue;
    }

    if (!raw.startsWith("-")) {
      newLine += 1;
    }
  }

  return result;
}
