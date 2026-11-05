const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();
function sourceKey(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port) return '';
    url.hash=''; url.searchParams.sort();
    return url.href.replace(/\/$/,'');
  } catch { return ''; }
}
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

// A branch list alone does not prove campaign participation.
export function matchChainRule(deal,rules=[],today) {
  const url=sourceKey(deal.url);
  if(!url||!Array.isArray(rules)) return null;
  const place=fold([deal.address,deal.location,deal.distance,deal.description].join(' '));
  if(/\b(nur|ausschliesslich|exklusiv)\b.{0,45}\b(filiale|standort|restaurant|scs|westbahnhof|donauzentrum)\b/.test(place)) return null;
  const exclusions=[...[deal.address,deal.location,deal.distance,deal.description].join('. ').matchAll(/\b(?:ausgenommen|außer|ausser|nicht g[üu]ltig)\s+([^.!?;\n]+)/gi)].map(match=>fold(match[1]));
  const matches=rules.filter(rule=>rule&&rule.reviewed===true&&rule.evidenceUrl&&validDay(rule.validFrom)&&(!rule.validUntil||validDay(rule.validUntil))
    &&rule.validFrom<=today&&(!rule.validUntil||rule.validUntil>=today)
    &&Array.isArray(rule.brands)&&rule.brands.some(brand=>fold(brand)===fold(deal.brand))
    &&Array.isArray(rule.sourceUrls)&&rule.sourceUrls.some(source=>sourceKey(source)===url)
    &&Array.isArray(rule.titleTerms)&&rule.titleTerms.length&&rule.titleTerms.some(term=>fold(term)&&fold(deal.title).includes(fold(term)))
    &&Array.isArray(rule.locationIds)&&rule.locationIds.every(id=>typeof id==='string'&&id)
    &&Array.isArray(rule.addresses||[])&&(rule.addresses||[]).every(address=>address.street&&/^\d+[a-z]?(?:[-/]\d+)?$/i.test(address.number)&&/^1\d{3}$/.test(address.postalCode))
    &&(rule.locationIds.length||(rule.addresses||[]).length)
    &&exclusions.every(clause=>(rule.allowedExclusions||[]).some(value=>fold(value)===clause))
    &&Array.isArray(rule.excludedLocationIds)&&!rule.locationIds.some(id=>rule.excludedLocationIds.includes(id)));
  return matches.length===1?matches[0]:null;
}
