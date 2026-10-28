(function (root) {
  const GF_CIDADES = {
    "Alegrete":[-29.783,-55.791],"Uruguaiana":[-29.755,-57.088],"Santana do Livramento":[-30.891,-55.532],
    "Rosário do Sul":[-30.258,-54.914],"Quaraí":[-30.388,-56.451],"São Gabriel":[-30.336,-54.320],
    "Bagé":[-31.331,-54.107],"Cacequi":[-29.883,-54.825],"Santa Maria":[-29.684,-53.807],
    "São Borja":[-28.660,-56.004],"Itaqui":[-29.125,-56.553],"Manoel Viana":[-29.586,-55.484],
    "Jaguari":[-29.497,-54.690],"São Vicente do Sul":[-29.688,-54.680],"São Pedro do Sul":[-29.620,-54.179],
    "Santiago":[-29.191,-54.866],"Dom Pedrito":[-30.983,-54.673],"Lavras do Sul":[-30.813,-53.894],
    "Caçapava do Sul":[-30.512,-53.491],"Cachoeira do Sul":[-30.039,-52.894],"Santa Cruz do Sul":[-29.718,-52.426],
    "Porto Alegre":[-30.035,-51.218],"Pelotas":[-31.765,-52.338],"Passo Fundo":[-28.262,-52.407],
    "Ijuí":[-28.388,-53.915],"Cruz Alta":[-28.638,-53.606],"Santo Ângelo":[-28.300,-54.263],
    "Júlio de Castilhos":[-29.227,-53.682],"Tupanciretã":[-29.081,-53.836],"Mata":[-29.565,-54.462],
    "Maçambará":[-29.144,-56.067],"Barra do Quaraí":[-30.204,-57.550],"Caxias do Sul":[-29.168,-51.179],
    "São Sepé":[-30.161,-53.565],"Restinga Sêca":[-29.813,-53.381],"Formigueiro":[-30.003,-53.495],
    "Vila Nova do Sul":[-30.346,-53.876],"Santa Margarida do Sul":[-30.339,-54.083],"Hulha Negra":[-31.403,-53.869],
    "Candiota":[-31.558,-53.677],"Aceguá":[-31.866,-54.162],"Pinheiro Machado":[-31.578,-53.381],
    "Canguçu":[-31.395,-52.676],"Rio Grande":[-32.035,-52.099],"Camaquã":[-30.851,-51.812],
    "Santa Rosa":[-27.871,-54.481],"São Luiz Gonzaga":[-28.408,-54.961],"Unistalda":[-29.040,-55.152],
    "Itacurubi":[-28.791,-55.235],"Nova Esperança do Sul":[-29.406,-54.829]
  };
  const R = 6371, rad = x => x * Math.PI / 180;
  // distância em linha reta × 1,25 como estimativa de estrada
  function km(a, b) {
    const A = GF_CIDADES[a], B = GF_CIDADES[b]; if (!A || !B) return null;
    const dLat = rad(B[0] - A[0]), dLng = rad(B[1] - A[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A[0])) * Math.cos(rad(B[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h)) * 1.25;
  }
  // km a mais para quem vai de o→d pegando um serviço a→b no caminho
  function desvio(o, d, a, b) {
    const od = km(o, d), oa = km(o, a), ab = km(a, b), bd = km(b, d);
    if ([od, oa, ab, bd].some(v => v == null)) return null;
    return Math.max(0, Math.round(oa + ab + bd - od));
  }
  const GF_GEO = { km: (a, b) => { const v = km(a, b); return v == null ? null : Math.round(v); }, desvio };
  root.GF_CIDADES = GF_CIDADES; root.GF_GEO = GF_GEO;
  if (typeof module === 'object' && module.exports) module.exports = { GF_CIDADES, GF_GEO };
})(typeof window !== 'undefined' ? window : globalThis);
