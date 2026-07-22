export function scoreConfidence(buyer) {
  const populated = {
    sectorFocus: Boolean(buyer.sectorFocus && buyer.sectorFocus !== "NOT FOUND"),
    portfolioCompanies: Array.isArray(buyer.portfolioCompanies) && buyer.portfolioCompanies.length > 0,
    geography: Boolean(buyer.geography && buyer.geography !== "NOT FOUND"),
    investmentCriteria: Boolean(buyer.investmentCriteria && buyer.investmentCriteria !== "NOT FOUND"),
  };

  const populatedFieldCount = Object.values(populated).filter(Boolean).length;
  const sourceCount = (buyer.sourceUrls ?? []).length;

  let confidence;
  if (populatedFieldCount >= 3 && sourceCount >= 2) {
    confidence = "High";
  } else if (populatedFieldCount >= 2) {
    confidence = "Medium";
  } else {
    confidence = "Low";
  }

  const fieldList = Object.entries(populated)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const reasoning =
    `${populatedFieldCount} of 4 key fields populated` +
    (fieldList.length ? ` (${fieldList.join(", ")})` : "") +
    `, ${sourceCount} corroborating source${sourceCount !== 1 ? "s" : ""}`;

  return { confidence, populatedFieldCount, sourceCount, reasoning };
}
