export const LATENCY_TARGET_MS = 5000;

export const GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

export const REQUIRED_COMMON_FIELDS = [
  {
    key: "brandName",
    label: "Brand name",
    reason: "Brand name is a common mandatory label element."
  },
  {
    key: "classType",
    label: "Class/type",
    reason: "Class or type designation should appear on the label."
  },
  {
    key: "alcoholContent",
    label: "Alcohol content",
    reason: "Alcohol content is checked against the application text."
  },
  {
    key: "netContents",
    label: "Net contents",
    reason: "Net contents should appear on the label."
  },
  {
    key: "producerName",
    label: "Producer/bottler name",
    reason: "Name of the bottler, producer, or importer is a common label element."
  },
  {
    key: "producerAddress",
    label: "Producer/bottler address",
    reason: "Address of the bottler, producer, or importer is a common label element."
  }
];

export const WARNING_CHECKS = {
  exactText: "Government warning exact text",
  headingCaps: "Government warning heading caps",
  headingBold: "Government warning heading bold"
};
