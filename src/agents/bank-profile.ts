/**
 * The bank this instance of RuleForge is configured for.
 *
 * Mock data standing in for what would eventually come from a configuration
 * table. The applicability agent compares each circular against this profile to
 * decide whether the circular binds us at all, so the wording here is written
 * to be read by a model as much as by a person.
 */

export const BANK_PROFILE = {
  name: "Demo Bank of India",
  /** Licence category, which determines which directions apply. */
  bankType: "scheduled commercial bank",
  licenceNotes:
    "Licensed under the Banking Regulation Act, 1949. Not a regional rural bank, " +
    "co-operative bank, payments bank or small finance bank.",
  products: [
    "savings accounts",
    "current accounts",
    "UPI payments",
    "debit and credit cards",
    "retail loans",
    "MSME loans",
    "foreign remittance",
  ],
  regulators: ["RBI", "FIU-IND"],
  /** Rule categories this bank actively maintains rules for. */
  activeRuleCategories: ["aml", "kyc", "lending", "fraud"],
  jurisdiction: "India",
  notes: [
    "Operates only in India; no overseas branches or subsidiaries.",
    "Accepts cash deposits at branch counters, ATMs and cash recycler machines.",
    "Does not deal in securities, insurance underwriting or commodity derivatives.",
  ],
} as const;

export type BankProfile = typeof BANK_PROFILE;

/** The profile rendered for a prompt. Kept stable so prompts stay cacheable. */
export function bankProfileForPrompt(profile: BankProfile = BANK_PROFILE): string {
  return [
    `Name: ${profile.name}`,
    `Type: ${profile.bankType}`,
    `Licence: ${profile.licenceNotes}`,
    `Jurisdiction: ${profile.jurisdiction}`,
    `Regulators: ${profile.regulators.join(", ")}`,
    `Products: ${profile.products.join(", ")}`,
    `Active rule categories: ${profile.activeRuleCategories.join(", ")}`,
    `Notes:`,
    ...profile.notes.map((note) => `  - ${note}`),
  ].join("\n");
}
