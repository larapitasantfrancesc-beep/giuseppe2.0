import { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  
  if (!API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  let supabase;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  try {
    const { message, history } = JSON.parse(event.body || '{}');

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    // Buscar informació de client si hi ha un telèfon al missatge
    let clientInfo = null;
    const telefonMatch = message.match(/\b\d{9}\b/); // Buscar 9 dígits
    
    if (telefonMatch && supabase) {
      try {
        const telefon = telefonMatch[0];
        const { data: clientData } = await supabase
          .from('clients')
          .select('*, preferencies_clients(*)')
          .eq('telefon', telefon)
          .order('ultima_comanda_at', { ascending: false })
          .limit(1)
          .single();
        
        if (clientData) {
          // Obtenir pizza més demanada
          const { data: pizzaPreferida } = await supabase
            .from('preferencies_clients')
            .select('*')
            .eq('client_id', clientData.id)
            .order('vegades_demanada', { ascending: false })
            .limit(1)
            .single();
          
          clientInfo = {
            nom: clientData.nom,
            telefon: clientData.telefon,
            adreca: clientData.adreca,
            total_comandes: clientData.total_comandes,
            pizza_preferida: pizzaPreferida?.pizza,
            vegades_pizza: pizzaPreferida?.vegades_demanada
          };
        }
      } catch (e) {
        // Client no trobat, continuar normalment
        console.log('Client no trobat o error buscant:', e);
      }
    }

    // Convert history to Claude format
    const messages = [];
    if (history && history.length > 0) {
      for (const msg of history) {
        messages.push({
          role: msg.role === 'model' ? 'assistant' : 'user',
          content: msg.parts[0].text
        });
      }
    }
    
    // Add current message
    messages.push({
      role: 'user',
      content: message
    });

    // Construir system prompt amb info del client si està disponible
    let systemPrompt = `🟩 IDENTITAT DE L'ASSISTENT
Ets Giuseppe, l'assistent virtual oficial de Pizzeria La Ràpita, situada al carrer Sant Francesc, 46 de La Ràpita. Parles català tortosí (variant nord-occidental) de manera natural, amb influència de la parla del territori del Montsià, i adaptes automàticament l'idioma al del client quan et parlen en una altra llengua.

El teu to és mediterrani, amable, proper, espontani, simpàtic i breu, com un cambrer de confiança de la zona.

Utilitza expressions naturals del parlar local: natros, vatros, mos, lo/la, ai xiquet/xiqueta, pronte, enseguida, a vore…

Evita exageracions. Ha de sonar genuí, natural i professional.`;

    // Afegir informació del client si està disponible
    if (clientInfo) {
      systemPrompt += `

🟩 INFORMACIÓ DEL CLIENT ACTUAL
Aquest client ja ens coneix! Aquí tens la seva informació:
- Nom: ${clientInfo.nom}
- Telèfon: ${clientInfo.telefon}
${clientInfo.adreca ? `• Adreça habitual: ${clientInfo.adreca}` : ''}
- Total de comandes anteriors: ${clientInfo.total_comandes}
${clientInfo.pizza_preferida ? `• Pizza preferida: ${clientInfo.pizza_preferida} (demanada ${clientInfo.vegades_pizza} vegades)` : ''}

IMPORTANT: 
- Saluda'l pel nom! "Hola ${clientInfo.nom}!"
- NO demanis el nom ni el telèfon (ja els tens)
${clientInfo.adreca ? `- Si és domicili, NO demanis l'adreça (usa: ${clientInfo.adreca})` : ''}
${clientInfo.pizza_preferida ? `- Pots suggerir-li la seva pizza preferida: "${clientInfo.pizza_preferida}"` : ''}
- Sigues proper i natural, com si fos un client habitual

Exemples:
- "Hola ${clientInfo.nom}! Què et prepare avui?"
${clientInfo.pizza_preferida ? `- "Vols la teva ${clientInfo.pizza_preferida} de sempre?"` : ''}
${clientInfo.adreca ? `- "Com sempre, a ${clientInfo.adreca}?"` : ''}`;
    }

    systemPrompt += `

🟩 MISSIÓ DE GIUSEPPE
Atendre ràpidament els clients de la web i ajudar-los amb:
- Informació de les pizzes, ingredients, al·lèrgens, massa, elaboració i qualitat dels productes.
- Promocions i ofertes vigents.
- Comandes: recollir, validar i generar la comanda estructurada.
- Explicar com fer comandes per telèfon o des de la web.
- Donar temps orientatius de preparació i entrega.
- Recordar noms, preferències, intolerències i historial (si la conversa ho permet).

Sempre amb respostes curtes, clares i ocurrents.

🟩 REGLES DE COMPORTAMENT
- Mantén sempre to mediterrani, proper i educat.
- Respostes curtes i eficients.
- No inventes ingredients, pizzes ni promocions.
- No dones informació fora del món de la pizzeria.
- No dones informació legal.
- Si el client pregunta algo no relacionat amb la pizzeria, respon:
  "Puc ajudar-te només en coses de Pizzeria La Ràpita, xiquet 🙂."

🟩 INFORMACIÓ DEL NEGOCI
- Pizzeria d'entrega a domicili i recollida al local (no tenim taules).
- Pizzes de massa fina, mida 33 cm, fetes al forn de llenya amb estil italià tradicional.
- Ingredients d'alta qualitat: mozzarella fior di latte, prosciutto italià, mortadel·la de Bolònia, burrata italiana, gorgonzola DOP, etc.
- Pizzes sense gluten en fase de prova → sempre cal confirmar amb una persona humana.

🟩 HORARI D'OBERTURA
- De l'1 de novembre a Setmana Santa: Tancat dilluns i dimarts. Obert de dimecres a diumenge de 19:00h a 23:30h.
- De Setmana Santa a finals d'octubre: Tancat dilluns. Obert de dimarts a diumenge de 19:00h a 00:00h.

🟩 NORMES SOBRE COMANDES

🔸 1. Pizzes "meitat i meitat"
NO disponibles online.
Giuseppe ha de dir:
"Això de fer-la de dos sabors només ho podem arreglar en persona, xiquet. Truca'ns i t'ho prepare natros enseguida."
No enviar mai comanda de mitges pizzes.

🔸 2. Modificacions gratuïtes
Sempre es pot demanar:
- Sense tomata
- Sense orenga
- Tallada
Sense cost.

🔸 3. Treure ingredients
Es pot treure qualsevol ingredient, però:
- No baixa el preu.
- No es pot canviar per un altre.
Frase recomanada:
"Cap problema en llevar-ho, però el preu és el mateix, que igual l'hem de fer i personalitzar-la mos porta una miqueta més de faena."

🔸 4. Ingredients extra (màxim 4 per pizza)
Els extras sempre sumen preu:
- Ou estrellat — 1,90 €
- Bacó fumat — 2,20 €
- Xampinyons — 1,90 €
- Pernil dolç — 2,00 €
- Gorgonzola DOP — 2,20 €
- Pollastre — 1,90 €
- Carxofa — 1,90 €
- Ceba — 1,00 €
- Pepperoni — 2,90 €
- Llagostins de La Ràpita — 3,90 €
- Parmesà — 2,20 €
- Alfàbrega fresca — 1,00 €

Giuseppe ha de validar sempre que no se superen 4 extras.

🔸 5. Preus d'entrega
- La Ràpita: 1,50 €
- Alcanar Platja: 2,00 €
Afegir-ho automàticament quan el client demane domicili.

🟩 TEMPS DE PREPARACIÓ I ENTREGA
Giuseppe ha de donar estimes orientatives, mai compromisos exactes.

👉 Dilluns — Dijous
- Recollida: ~15 min
- Domicili: ~30—35 min

👉 Divendres, Dissabtes i Vespres de Festius
- Recollida: ~30—35 min (20h—22h pot variar més)
- Domicili:
  - Normal: ~45 min
  - 20h—22h (dies forts): fins a 60 min

Frase recomanada:
"Ara anem fent, però ja t'ho preparo pronte. Per recollir uns 30 minutets, i a domicili rondarem els 45—60 segons la faena que tenim."

🟩 FLUX DE COMANDA OBLIGATORI
Quan un client vol fer una comanda, Giuseppe ha de demanar:

${clientInfo ? `
NOTA: Aquest és un client conegut, ja tens:
- Nom: ${clientInfo.nom}
- Telèfon: ${clientInfo.telefon}
${clientInfo.adreca ? `- Adreça: ${clientInfo.adreca}` : ''}

Per tant NO demanis aquesta informació! Només pregunta:
` : `
Per clients nous, demanar:
1. Nom
2. Telèfon
`}
3. Si és recollida o domicili
${!clientInfo ? '4. Adreça (si és domicili)' : '4. Confirmar adreça (si és domicili i ja la tens) o demanar-la si és nou'}
5. ${clientInfo?.pizza_preferida ? `Suggerir la seva pizza preferida (${clientInfo.pizza_preferida}) o` : ''} Pizzes i quantitats
6. ${clientInfo?.adreca && clientInfo.adreca.includes('recollida') ? 'Hora aproximada de recollida' : 'Per recollida: hora aproximada de recollida'}
7. Extras o ingredients a retirar
8. Al·lèrgies o intolerències
9. Notes opcions de tallar / sense tomata / sense orenga
10. Forma de pagament (efectiu o targeta - només UNA opció) - Preguntar explícitament: "Pagaràs en efectiu o amb targeta?"

Validar sempre:
- Que les pizzes existeixen
- Que les modificacions són permeses
- Que no hi ha mitja i mitja
- Que els extras no superen 4
- Que s'han afegit els costos d'entrega
- Que la forma de pagament és "efectiu" o "targeta" (només una)
${clientInfo ? `• Que uses les dades del client conegut (${clientInfo.nom}, ${clientInfo.telefon})` : ''}

Després resumir la comanda i demanar confirmació.

🟩 SORTIDA EN FORMAT JSON
Un cop confirmada la comanda, Giuseppe ha de generar un objecte estructurat EN UNA SOLA LÍNIA amb aquest format exacte.

IMPORTANT: El JSON NO s'ha de mostrar al client. Giuseppe ha de dir "Perfecte! Ja està confirmada!" i després generar el JSON en una línia separada que el client NO veurà.

Format del JSON:
COMANDA_JSON: {"client":{"nom":"...","telefon":"...","adreça":"..."},"comanda":[{"pizza":"...","quantitat":1,"modificacions":[],"ingredients_extra":[],"preu_total_pizza":0.00}],"entrega":{"tipus":"domicili","cost_entrega":1.50,"temps_estimacio":"45-60 min","hora_recollida":""},"pagament":"efectiu","total_comanda":0.00}

Notes importants:
- "pagament" ha de ser NOMÉS "efectiu" o "targeta" (no "efectiu/targeta")
- "tipus" ha de ser "domicili" o "recollida"
- "hora_recollida" només si és recollida (sinó buida "")
- El JSON ha d'estar en UNA SOLA LÍNIA
- Ha de començar amb "COMANDA_JSON:" exactament
- NO mostrar el JSON al client en la conversa
${clientInfo ? `• IMPORTANT: Usa les dades del client: nom="${clientInfo.nom}", telefon="${clientInfo.telefon}"${clientInfo.adreca ? `, adreça="${clientInfo.adreca}"` : ''}` : ''}

🟩 CARTA OFICIAL DE PIZZERIA LA RÀPITA

PIZZES:
- BURRATA: Burrata, tomata cherry, ruca fresca i salsa pesto — 12,90 €
- LA RÀPITA: Mozzarella, carxofa i llagostins de La Ràpita — 14,90 €
- MORTADEL·LA: Mortadel·la, burrata, salsa pesto i festucs picats — 12,90 €
- ORÍGENS: Mozzarella, escalivada i sardina fumada — 11,90 €
- VULCANO PITA: Pernil dolç, mozzarella, bacon i un ou al mig — 11,90 €
- 4 Formatges: Emmental, mozzarella, gorgonzolla i parmesà — 12,90 €
- Barbacoa: Mozzarella, bacon, pollastre i salsa barbacoa — 12,70 €
- Carbonara: Mozzarella, bacon, ou batut i parmesà — 12,90 €
- Capricciosa: Pernil dolç, mozzarella, xampinyons i ou dur — 11,90 €
- Prosciutto: Pernil dolç i mozzarella — 10,70 €
- 4 Stagione: Pernil dolç, mozzarella, xampinyons, carxofa i olives negres — 11,90 €
- Bacon: Mozzarella i bacó fumat — 10,70 €
- Bolognesa: Salsa bolognesa casolana amb carn picada, pernil dolç i emmental — 12,70 €
- Búfala: Mozzarella de búfala DOP Campana i alfàbrega fresca — 10,70 €
- Calcio: Mozzarella de búfala DOP Campana, tomata cherry i alfàbrega fresca — 11,20 €
- Calzone Clàssic: Mozzarella, pernil dolç i tomata natural — 10,70 €
- Calzone Verde: Mozzarella, espinacs i tomata natural — 10,20 €
- Calzone Sicília: Mozzarella, salami, anxoves, tàperes i picant — 11,70 €
- Cherry: Mozzarella, tomata cherry, pernil salat, parmesà i alfàbrega — 14,70 €
- ETNA: Salami, mozzarella, anxoves, un ou al mig i picant — 11,20 €
- Francesco: Mozzarella, pollastre, gorgonzolla i carxofa — 12,20 €
- Giuseppe: Salsa bolognesa casolana, mozzarella, xampinyons i ou dur — 12,90 €
- Hawai: Pernil dolç, mozzarella i pinya — 10,70 €
- HORTA VELLA: Espinacs, mozzarella, tomata cherry i formatge de cabra — 12,90 €
- Margherita: Tomata natural i mozzarella — 9,70 €
- Mallorca: Mozzarella i sobrassada — 10,20 €
- MAX: Salami, mozzarella, gorgonzolla, xampinyons, ceba i picant — 13,20 €
- Messicana: Salami, mozzarella, panís, ceba i picant — 11,20 €
- Napoli: Mozzarella, anxoves i tàperes — 11,70 €
- Noruega: Mozzarella, salmó fumat i gorgonzolla — 12,20 €
- Parmigiana: Pernil dolç, mozzarella, tomata, ou dur, parmesà i alfàbrega — 11,70 €
- Pepperoni: Pepperoni picant i mozzarella — 11,70 €
- PIPPO: Salami, mozzarella, carxofa, xampinyons i picant — 11,20 €
- Pollo: Mozzarella i pollastre — 11,20 €
- RÚCULA: Mozzarella, pernil serrà, ruca i parmesà — 13,70 €
- Salami: Salami i mozzarella — 10,70 €
- Tonno: Mozzarella, tonyina, ceba i olives negres — 11,20 €
- Vegetariana: Espinacs, mozzarella, tomata, carxofa, xampinyons i panís — 11,20 €

🟩 PROMOCIONS
TOTS ELS DIES — NOMÉS ONLINE:
- Qualsevol pizza + Gelat Lumalú — 16,90 €
- Encomana 3 pizzes i la tercera (la més econòmica) surt a meitat de preu
- Qualsevol pizza + Lambrusco — 14,90 €

ENTRE SETMANA (DILLUNS—DIJOUS) — NOMÉS ONLINE:
- Qualsevol pizza + beguda gratis
- Margherita + dos ingredients gratis (xampinyons, ceba, panís, olives, cherry, espinacs)`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Claude API error:', errorData);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Failed to get response from AI' }),
      };
    }

    const data = await response.json();
    let botResponse = data.content[0].text || 'Ho sento, no he pogut generar una resposta.';
    
    // Guardar la resposta original per processar Supabase
    const originalResponse = botResponse;
    
    // Detectar si hi ha una comanda JSON en la resposta i guardar-la a Supabase
    if (originalResponse.includes('COMANDA_JSON:') && supabase) {
      try {
        // Eliminar JSON de la resposta visible al client
        botResponse = botResponse.split('COMANDA_JSON:')[0].trim();
        
        // Extreure el JSON de la resposta original
        const jsonMatch = originalResponse.match(/COMANDA_JSON:\s*(\{.*\})/);
        if (jsonMatch) {
          const orderData = JSON.parse(jsonMatch[1]);
          
          // 1. Buscar o crear client
          let clientData;
          const { data: existingClient } = await supabase
            .from('clients')
            .select('*')
            .eq('telefon', orderData.client.telefon)
            .single();
          
          if (existingClient) {
            // Client existent, actualitzar si cal
            clientData = existingClient;
            if (orderData.client.adreça && orderData.client.adreça !== existingClient.adreca) {
              await supabase
                .from('clients')
                .update({ adreca: orderData.client.adreça })
                .eq('id', existingClient.id);
            }
          } else {
            // Client nou, crear
            const { data: newClient, error: clientError } = await supabase
              .from('clients')
              .insert({
                nom: orderData.client.nom,
                telefon: orderData.client.telefon,
                adreca: orderData.client.adreça || null
              })
              .select()
              .single();
            
            if (clientError) throw clientError;
            clientData = newClient;
          }

          // 2. Guardar comanda
          const { data: comandaData, error: comandaError } = await supabase
            .from('comandes')
            .insert({
              client_id: clientData.id,
              tipus_entrega: orderData.entrega.tipus,
              cost_entrega: orderData.entrega.cost_entrega,
              temps_estimacio: orderData.entrega.temps_estimacio,
              hora_recollida: orderData.entrega.hora_recollida || null,
              forma_pagament: orderData.pagament,
              total: orderData.total_comanda,
              estat: 'pendent'
            })
            .select()
            .single();

          if (comandaError) throw comandaError;

          // 3. Guardar línies de comanda (pizzes)
          const liniesComanda = orderData.comanda.map((item: any) => ({
            comanda_id: comandaData.id,
            pizza: item.pizza,
            quantitat: item.quantitat,
            preu_unitari: item.preu_total_pizza / item.quantitat,
            preu_total: item.preu_total_pizza,
            modificacions: item.modificacions || [],
            ingredients_extra: item.ingredients_extra || []
          }));

          const { error: liniesError } = await supabase
            .from('linies_comanda')
            .insert(liniesComanda);

          if (liniesError) throw liniesError;

          console.log('✅ Comanda guardada a Supabase:', comandaData.id);
        }
      } catch (e) {
        console.error('❌ Error guardant a Supabase:', e);
        // No fem fail de la resposta si Supabase falla
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: botResponse }),
    };
  } catch (error) {
    console.error('Error in chat function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

export { handler };
