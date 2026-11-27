import ES from "../../i18n/reviewed/es.json";

/**
 * Human-reviewed translations, kept in the repository. They always win over the machine
 * translations stored in the database, and the background translator never touches them.
 *
 * Spanish (es): the public website (home, pricing, how it works, tools, every tool page, contact,
 * sign-in/sign-up, terms and privacy), written as natural, neutral Spanish for readers in Spain,
 * Latin America and the US, addressing the reader as "tú".
 */
export const REVIEWED: Record<string, Record<string, string>> = { es: ES as Record<string, string> };

/**
 * Per-language style guide and glossary for the machine translator, so text that isn't reviewed
 * (mostly the app's own interface) matches the reviewed pages in tone and terminology.
 * Bump `version` when the guide changes: existing machine translations of that language are then
 * redone in the background (the old text stays visible until each new one is ready).
 */
export const STYLE: Record<string, { version: number; notes: string }> = {
  es: {
    version: 2,
    notes: `Write neutral international Spanish that reads naturally in Spain, Latin America and the US. Address the reader as "tú" (never "usted"), and avoid regionalisms. Prefer short, everyday wording over literal calques from English ("Se acabó volver a teclear cifras", not "No más reescribir cifras").
Glossary (use exactly these terms):
- upload / download: subir / descargar · file: archivo · tool: herramienta · sign up / sign in: registrarse / iniciar sesión
- workspace: espacio de trabajo · workbench: mesa de trabajo · library: biblioteca · trash: papelera · version history: historial de versiones
- Day Pass: Pase de un día · Free plan: Gratis · Pro: Pro · Team (plan): Team · free trial: prueba gratuita · Upgrade (button): Mejorar plan
- AI credits: créditos de IA · task: tarea · Edit PDF: Editar PDF · Read PDF: Leer PDF · Ask AI: Preguntar a la IA
- merge / split / compress / rotate / organize: unir / dividir / comprimir / girar / organizar · watermark: marca de agua · page numbers: números de página
- redact / redaction: censurar / censura · OCR: OCR ("aplicar OCR") · scan: escanear / escaneo · searchable: que se puede buscar
- fill a form: rellenar un formulario · e-signature: firma electrónica · request signature: pedir firma · signer: firmante · audit trail: registro de auditoría · certificate of completion: certificado de finalización
- document request: solicitud de documentos · one-time code: código de un solo uso · hand off: pasar a / traspaso
- bank statement: estado de cuenta (bancario) · transaction: movimiento · balance: saldo · invoice: factura · line item: concepto · receipt: recibo · spreadsheet: hoja de cálculo · workbook: libro
- Settings → Billing: Configuración → Facturación · Members: Miembros
- Phone: móvil · computer: computadora`,
  },
};
