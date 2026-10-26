/**
 * Form filler: the shared model for fields, answers and the reusable "profile" people fill forms
 * from. Used on both server and client, so nothing here may import server-only modules.
 */

/** x, y, width, height in PDF points with the origin at the page's bottom-left (pdf-lib's space). */
export type Rect = [number, number, number, number];

export type FieldType =
  | "text"
  | "multiline"
  | "date"
  | "number"
  | "email"
  | "phone"
  | "checkbox"
  | "radio"
  | "choice"
  | "signature"
  | "initials";

/** A choice in a radio group or dropdown. Radio options drawn on the page carry their own box. */
export type FieldOption = { value: string; label: string; page?: number; rect?: Rect };

export type FormField = {
  id: string;
  page: number; // 1-based
  rect: Rect;
  type: FieldType;
  label: string;
  section?: string;
  /** Plain-language explanation of what the form is asking for. */
  help?: string;
  /** Profile entry that answers this field, e.g. "first_name" (see PROFILE_FIELDS). */
  profileKey?: string | null;
  /** SSNs, account numbers and similar: filled per form, never saved to a profile. */
  sensitive?: boolean;
  required?: boolean;
  options?: FieldOption[];
  /** Date layout for date fields, e.g. "MM/DD/YYYY". */
  format?: string;
  maxLength?: number;
  /** One character per box (e.g. SSN boxes); needs maxLength. */
  comb?: boolean;
  /** Fully qualified AcroForm field name when the PDF already has a fillable field here. */
  acro?: string;
  readOnly?: boolean;
};

export type ValueSource = "profile" | "ai" | "you" | "document" | "auto";
export type FieldValue = { value: string; source: ValueSource; confidence?: number; note?: string };
export type FormValues = Record<string, FieldValue>;

export type FormSummary = {
  title: string;
  purpose: string;
  whoFills?: string;
  submitTo?: string;
  deadline?: string;
  tips?: string[];
};

export type FormTemplate = {
  fields: FormField[];
  summary: FormSummary | null;
  /** True when the fields come from the PDF's own fillable form. */
  acro: boolean;
  /** "ai" when the layout was read by AI, "pdf" when it came only from the file. */
  detectedBy: "ai" | "pdf" | "manual";
  versionId: string;
  updatedAt: number;
};

// ---------- profiles ----------

export type ProfileKind = "person" | "business";
export type ProfileCustom = { label: string; value: string };
export type ProfileData = {
  values: Record<string, string>;
  /** Answers learned from forms that don't fit a standard entry ("Student ID", "Pet's name"). */
  custom: ProfileCustom[];
  signature?: string | null; // PNG data URL
  initials?: string | null;
};
export type Profile = { id: string; name: string; kind: ProfileKind; data: ProfileData; updatedAt: number };

type ProfileFieldDef = { key: string; label: string; section: string; kind?: ProfileKind; input?: "date" | "email" | "tel" | "textarea" };

/** Standard profile entries. Keys are stable: forms remember which entry fills which field. */
export const PROFILE_FIELDS: ProfileFieldDef[] = [
  { key: "first_name", label: "First name", section: "Identity" },
  { key: "middle_name", label: "Middle name", section: "Identity" },
  { key: "last_name", label: "Last name", section: "Identity" },
  { key: "preferred_name", label: "Preferred name", section: "Identity" },
  { key: "date_of_birth", label: "Date of birth", section: "Identity", input: "date" },
  { key: "place_of_birth", label: "Place of birth", section: "Identity" },
  { key: "gender", label: "Gender", section: "Identity" },
  { key: "marital_status", label: "Marital status", section: "Identity" },
  { key: "citizenship", label: "Citizenship", section: "Identity" },
  { key: "email", label: "Email", section: "Contact", input: "email" },
  { key: "phone", label: "Phone", section: "Contact", input: "tel" },
  { key: "alt_phone", label: "Other phone", section: "Contact", input: "tel" },
  { key: "address_line1", label: "Street address", section: "Address" },
  { key: "address_line2", label: "Apt, suite, unit", section: "Address" },
  { key: "city", label: "City", section: "Address" },
  { key: "state", label: "State / province", section: "Address" },
  { key: "postal_code", label: "ZIP / postal code", section: "Address" },
  { key: "country", label: "Country", section: "Address" },
  { key: "county", label: "County", section: "Address" },
  { key: "years_at_address", label: "Years at this address", section: "Address" },
  { key: "previous_address", label: "Previous address", section: "Address", input: "textarea" },
  { key: "employer", label: "Employer", section: "Work" },
  { key: "job_title", label: "Job title", section: "Work" },
  { key: "employer_address", label: "Employer address", section: "Work", input: "textarea" },
  { key: "employer_phone", label: "Employer phone", section: "Work", input: "tel" },
  { key: "employment_start_date", label: "Start date", section: "Work", input: "date" },
  { key: "annual_income", label: "Annual income", section: "Work" },
  { key: "emergency_contact_name", label: "Emergency contact", section: "Emergency contact" },
  { key: "emergency_contact_relationship", label: "Relationship", section: "Emergency contact" },
  { key: "emergency_contact_phone", label: "Contact phone", section: "Emergency contact", input: "tel" },
  { key: "drivers_license_state", label: "Driver's license state", section: "Other" },
  { key: "vehicle", label: "Vehicle (year, make, model)", section: "Other" },
  { key: "license_plate", label: "License plate", section: "Other" },
  { key: "school", label: "School / university", section: "Other" },
  { key: "degree", label: "Degree", section: "Other" },
  { key: "business_name", label: "Business name", section: "Business", kind: "business" },
  { key: "business_type", label: "Entity type (LLC, Corp…)", section: "Business", kind: "business" },
  { key: "ein", label: "EIN", section: "Business", kind: "business" },
  { key: "business_address", label: "Business address", section: "Business", kind: "business", input: "textarea" },
  { key: "business_phone", label: "Business phone", section: "Business", kind: "business", input: "tel" },
  { key: "business_email", label: "Business email", section: "Business", kind: "business", input: "email" },
  { key: "website", label: "Website", section: "Business", kind: "business" },
  { key: "business_start_date", label: "Date established", section: "Business", kind: "business", input: "date" },
];

/** Keys computed from other entries (and today's date) rather than stored. */
export const DERIVED_KEYS: Record<string, string> = {
  full_name: "Full name",
  full_address: "Full address",
  city_state_zip: "City, state, ZIP",
  age: "Age",
  today: "Today's date",
  signature: "Signature",
  initials: "Initials",
};

export const PROFILE_KEY_LABELS: Record<string, string> = {
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, f.label])),
  ...DERIVED_KEYS,
};

/** Never saved to a profile, whatever the form calls them. */
const SENSITIVE = /\b(ssn|social security|tax ?id|itin|tin\b|passport|driver'?s? licen[cs]e (no|num)|licen[cs]e number|bank|routing|account (no|num)|iban|swift|card number|credit card|cvv|cvc|pin\b|password|medical record|diagnos|medication|health insurance (id|member)|member id)/i;

export function looksSensitive(label: string) {
  return SENSITIVE.test(label);
}

export function emptyProfile(): ProfileData {
  return { values: {}, custom: [] };
}

// ---------- dates ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Accepts ISO dates and common US/EU layouts; returns YYYY-MM-DD or null. */
export function toIsoDate(input: string): string | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] - (2000 + +m[3] > new Date().getFullYear() + 1 ? 100 : 0) : +m[3];
    return iso(y, +m[1], +m[2]) ?? iso(y, +m[2], +m[1]);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /[a-z]/i.test(s)) {
    const d = new Date(t);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

function iso(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1800 || y > 2200) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Lays out an ISO date the way the form asks: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, "Month D, YYYY"… */
export function formatDate(isoDate: string, format = "MM/DD/YYYY"): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const [, Y, M, D] = m;
  if (/month/i.test(format)) return `${MONTHS[+M - 1]} ${+D}, ${Y}`;
  return format
    .replace(/YYYY/, Y)
    .replace(/YY/, Y.slice(2))
    .replace(/MM/, M)
    .replace(/DD/, D)
    .replace(/(^|[^A-Z])M(?!M)/, `$1${+M}`)
    .replace(/(^|[^A-Z])D(?!D)/, `$1${+D}`);
}

export function todayIso() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())!;
}

// ---------- profile → field ----------

/** The value a profile gives for a key, laid out for the field (dates in the form's format). */
export function profileValue(key: string, profile: ProfileData | null | undefined, field?: Pick<FormField, "type" | "format">): string {
  const v = profile?.values ?? {};
  const join = (parts: (string | undefined)[], sep = " ") => parts.map((p) => p?.trim()).filter(Boolean).join(sep);
  let out = "";
  switch (key) {
    case "full_name":
      out = join([v.first_name, v.middle_name, v.last_name]);
      break;
    case "city_state_zip":
      out = join([v.city ? `${v.city},` : "", v.state, v.postal_code]);
      break;
    case "full_address":
      out = join([v.address_line1, v.address_line2, v.city ? `${v.city},` : "", v.state, v.postal_code], " ").replace(/\s+,/g, ",");
      break;
    case "age": {
      const dob = v.date_of_birth && toIsoDate(v.date_of_birth);
      if (dob) {
        const [y, m, d] = dob.split("-").map(Number);
        const now = new Date();
        out = String(now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0));
      }
      break;
    }
    case "today":
      out = todayIso();
      break;
    case "signature":
    case "initials":
      return "";
    default:
      if (key.startsWith("custom:")) out = profile?.custom.find((c) => slug(c.label) === key.slice(7))?.value ?? "";
      else out = v[key] ?? "";
  }
  if (field?.type === "date" || key === "today" || key === "date_of_birth") {
    const d = toIsoDate(out);
    if (d) return formatDate(d, field?.format);
  }
  return out;
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
}

// ---------- validation ----------

export function validate(field: FormField, value: string): string | null {
  const v = value.trim();
  if (!v) return field.required && field.type !== "checkbox" ? "Required" : null;
  switch (field.type) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : "Check the email address";
    case "phone":
      return v.replace(/\D/g, "").length >= 7 ? null : "Check the phone number";
    case "date":
      return toIsoDate(v) ? null : `Use a date like ${formatDate("2026-03-14", field.format)}`;
    case "number":
      return /^[-+$€£]?\s*[\d,.]+%?$/.test(v) ? null : "Numbers only";
  }
  if (field.maxLength && v.length > field.maxLength) return `At most ${field.maxLength} characters`;
  return null;
}

/** A field counts as answered once it has a value (a checkbox left unticked is a valid answer). */
export function isAnswered(field: FormField, value: FieldValue | undefined) {
  if (field.type === "checkbox") return true;
  return Boolean(value?.value?.trim());
}

// ---------- understanding field names without AI ----------

const ABBREVIATIONS: Record<string, string> = {
  dob: "Date of birth",
  ssn: "Social Security number",
  zip: "ZIP code",
  zipcode: "ZIP code",
  addr: "Address",
  tel: "Phone",
  fname: "First name",
  lname: "Last name",
  mi: "Middle initial",
  sig: "Signature",
  dl: "Driver's license number",
};

/** Expands the abbreviations PDF authors use in field names. */
export function expandLabel(label: string): string {
  const k = label.toLowerCase().replace(/[^a-z]/g, "");
  return ABBREVIATIONS[k] ?? label;
}

// Checked in order: specific rules first ("employer phone" before "phone").
const GUESSES: [RegExp, string, FieldType?][] = [
  [/city,? state,? (and )?zip/i, "city_state_zip"],
  [/(employer|company|work).*(phone|tel)/i, "employer_phone", "phone"],
  [/(employer|company|work).*address/i, "employer_address"],
  [/emergency.*(phone|tel)/i, "emergency_contact_phone", "phone"],
  [/emergency.*relationship|relationship.*emergency/i, "emergency_contact_relationship"],
  [/previous.*address|prior address/i, "previous_address"],
  [/(spouse|co-?applicant|reference|landlord|parent|guardian|child|student|patient|minor|beneficiary|employee'?s? supervisor)/i, ""],
  [/\b(first|given)\s*name|\bfname\b/i, "first_name"],
  [/\b(last|family|sur)\s*name|\blname\b/i, "last_name"],
  [/\bmiddle\s*name/i, "middle_name"],
  [/\b(full|legal|applicant'?s?|your)\s*name\b|^name$/i, "full_name"],
  [/date of birth|birth\s*date|\bdob\b/i, "date_of_birth", "date"],
  [/e-?mail/i, "email", "email"],
  [/(mobile|cell|home|day(time)?)?\s*(phone|telephone|tel)\b(?!.*(employer|work|emergency))/i, "phone", "phone"],
  [/\b(street|mailing|home|current)?\s*address\b(?!.*(employer|previous|business|email))(?!.*line ?2)/i, "address_line1"],
  [/\b(apt|suite|unit)\b|address line ?2/i, "address_line2"],
  [/\bcity\b(?!.*(state|zip))/i, "city"],
  [/^state\b|\bstate\/province\b/i, "state"],
  [/\bzip\b|postal\s*code/i, "postal_code"],
  [/\bcountry\b/i, "country"],
  [/\bemployer\b(?!.*(address|phone))/i, "employer"],
  [/job title|occupation|position/i, "job_title"],
  [/emergency contact(?!.*(phone|relationship))/i, "emergency_contact_name"],
  [/^signature$|\bsignature of (applicant|employee|patient|parent)/i, "signature", "signature"],
  [/^date$|date signed/i, "today", "date"],
];

/** Best guess at what a field asks for, from its label alone. AI does better, but this is free. */
export function guessFromLabel(label: string): { profileKey?: string; type?: FieldType } {
  const l = label.trim();
  for (const [re, key, type] of GUESSES) {
    // Fields about someone else (spouse, references…) never take the person's own details.
    if (re.test(l)) return key ? { profileKey: key, type } : { type };
  }
  return {};
}
