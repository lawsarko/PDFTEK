/** Topics on the contact form; shared by the page and the API. */
export const CONTACT_TOPICS = ["General question", "Billing & payments", "Technical problem", "Feature request", "Business & partnerships", "Privacy & data request"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];
