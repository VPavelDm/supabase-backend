-- Built-in collections in the app's other languages: de, fr, es, it, nl, pt-br, pt-pt, ru, tr, ar, ja, ko, zh-hans, zh-hant.
-- affirmations_get_library already picks the caller's language (then its base,
-- then English) for both the title and the affirmations; this only adds rows.
--
-- Same id scheme as the English seed (collection, language, position), so a
-- re-run inserts nothing and never overwrites. collection_items is keyed by
-- (collection_id, position), so each language gets its own position range
-- (language index * 100 + 1..8); the library filters items by language.

create temp table builtin_l10n (slug text, language text, base_position int,
                                title text, subtitle text, texts text[]);

insert into builtin_l10n values
  ('morning-3-min', 'de', 100, 'Morgens, 3 Min.', 'Ein ruhiger, klarer Start in den Tag', array[
    'Ich begrüße diesen Tag mit offenem und ruhigem Herzen.',
    'Ich habe alles, was ich brauche, um diesem Tag gelassen zu begegnen.',
    'Ich konzentriere mich heute auf das, was ich beeinflussen kann.',
    'Meine Energie ist klar, und mein Geist ist wach.',
    'Ich erlaube mir, sanft in den Tag zu starten.',
    'Heute gehe ich in einem Tempo, das sich für mich richtig anfühlt.',
    'Ich bin dankbar für diesen neuen Anfang.',
    'Ich vertraue darauf, dass ich mit allem umgehen kann, was dieser Tag bringt.'
  ]),
  ('cant-sleep', 'de', 100, 'Kann nicht schlafen', 'Den Kopf beruhigen und sanft einschlafen', array[
    'Ich lasse den heutigen Tag los und alles, was er von mir verlangt hat.',
    'Meine Gedanken haben Zeit bis morgen, jetzt ruhe ich mich aus.',
    'Mein Körper ist schwer, warm und geborgen.',
    'Mit jedem Ausatmen lasse ich ein wenig mehr los.',
    'Ich habe heute genug getan, und heute Nacht bin ich genug.',
    'Der Schlaf kommt ganz von selbst, wenn ich aufhöre, ihm nachzujagen.',
    'Ich bin sicher hier, in diesem Moment, in diesem Bett.',
    'Morgen wache ich ausgeruht und mit neuer Kraft auf.'
  ]),
  ('before-a-big-meeting', 'de', 100, 'Vor dem großen Meeting', 'Geerdet und klar in den Raum gehen', array[
    'Ich bin vorbereitet und weiß mehr, als ich mir selbst zutraue.',
    'Meine Stimme verdient es, in diesem Raum gehört zu werden.',
    'Ich kann innehalten, atmen und klar antworten.',
    'Nervosität zeigt, dass es mir wichtig ist, nicht dass ich unvorbereitet bin.',
    'Ich spreche langsam, einfach und selbstbewusst.',
    'Ich muss nicht perfekt sein, um hier wertvoll zu sein.',
    'Ich bringe Ruhe in jedes Gespräch, an dem ich teilnehme.',
    'Wie auch immer es ausgeht, ich lerne daraus und wachse daran.'
  ]),
  ('after-a-hard-day', 'de', 100, 'Nach einem harten Tag', 'Sei heute Abend gut zu dir', array[
    'Es war ein schwerer Tag, kein schweres Leben.',
    'Ich habe heute mein Bestes gegeben, mit dem, was ich hatte.',
    'Heute Abend lasse ich los, was ich nicht ändern kann.',
    'Mein Wert hängt nicht an einem schwierigen Tag.',
    'Ich darf mich ausruhen, ohne es mir verdienen zu müssen.',
    'Ich behandle mich mit der Freundlichkeit, die ich anderen schenke.',
    'Dieses Gefühl geht vorbei, und es wird wieder leichter.',
    'Ich bin stolz auf mich, dass ich diesen Tag geschafft habe.'
  ]),
  ('exam-day', 'de', 100, 'Prüfungstag', 'Konzentriert, klar und gelassen bleiben', array[
    'Ich habe mich vorbereitet, und mein Kopf erinnert sich an das Gelernte.',
    'Ich lese jede Frage in Ruhe und beantworte, was ich weiß.',
    'Wenn ich hänge, atme ich durch und mache entspannt weiter.',
    'Mein Fokus ist scharf, und meine Gedanken sind klar.',
    'Eine Prüfung bestimmt weder meine Zukunft noch meinen Wert.',
    'Ich vertraue auf die Arbeit, die ich schon geleistet habe.',
    'Ich bleibe im Moment, eine Frage nach der anderen.',
    'Ich verlasse diese Prüfung stolz auf meinen Einsatz.'
  ]),
  ('worthy-as-i-am', 'de', 100, 'Wertvoll, wie ich bin', 'Selbstwert für die stillen Momente', array[
    'Ich bin liebenswert, genau so, wie ich jetzt bin.',
    'Ich muss niemandem meinen Wert beweisen.',
    'Ich spreche mit mir selbst geduldig und warmherzig.',
    'Meine Bedürfnisse zählen, und ich achte sie.',
    'Ich darf Raum einnehmen.',
    'Ich verzeihe mir, was ich damals noch nicht wusste.',
    'Ich werde zu einem Menschen, auf den ich stolz bin.',
    'Ich verdiene die gleiche Fürsorge, die ich so gern anderen schenke.'
  ]),
  ('morning-3-min', 'fr', 200, 'Matin, 3 min', 'Un début de journée calme et serein', array[
    'J''accueille cette journée avec un cœur ouvert et apaisé.',
    'J''ai tout ce qu''il me faut pour vivre cette journée avec calme.',
    'Aujourd''hui, je me concentre sur ce qui dépend de moi.',
    'Mon énergie est claire et mon esprit est disponible.',
    'Je m''autorise à commencer en douceur.',
    'Aujourd''hui, j''avance à un rythme qui me convient.',
    'Je ressens de la gratitude pour ce nouveau départ.',
    'Je me fais confiance pour faire face à tout ce que cette journée m''apporte.'
  ]),
  ('cant-sleep', 'fr', 200, 'Impossible de dormir', 'Calme ton esprit et endors-toi doucement', array[
    'Je laisse partir cette journée et tout ce qu''elle m''a demandé.',
    'Mes pensées peuvent attendre demain, maintenant je me repose.',
    'Mon corps est lourd, chaud et en sécurité.',
    'À chaque expiration, je lâche prise un peu plus.',
    'J''en ai fait assez aujourd''hui, et ce soir, je mérite le repos.',
    'Le sommeil vient facilement quand j''arrête de le poursuivre.',
    'Je suis en sécurité ici, dans cet instant, dans ce lit.',
    'Demain, je me lèverai avec de l''énergie et l''esprit clair.'
  ]),
  ('before-a-big-meeting', 'fr', 200, 'Avant une réunion clé', 'Arrive avec calme et clarté', array[
    'J''ai bien travaillé en amont, et j''en sais plus que je ne le pense.',
    'Ma voix mérite d''être entendue dans cette pièce.',
    'Je peux faire une pause, respirer et répondre avec clarté.',
    'Le trac montre que cela compte pour moi, pas que je manque de préparation.',
    'Je parle lentement, simplement et avec assurance.',
    'Je n''ai pas besoin de perfection pour apporter de la valeur ici.',
    'J''apporte du calme dans chaque échange auquel je participe.',
    'Quel que soit le résultat, j''en tirerai des leçons pour grandir.'
  ]),
  ('after-a-hard-day', 'fr', 200, 'Après une dure journée', 'Prends soin de toi ce soir', array[
    'C''était une journée difficile, pas une vie difficile.',
    'J''ai fait de mon mieux aujourd''hui avec ce que j''avais.',
    'Ce soir, je lâche ce que je ne peux pas changer.',
    'Ma valeur ne se mesure pas à une seule journée difficile.',
    'J''ai le droit de me reposer sans avoir à le mériter.',
    'Je me traite avec la bienveillance que j''offre aux autres.',
    'Ce sentiment va passer, et tout deviendra plus léger.',
    'Je ressens de la fierté d''avoir traversé cette journée.'
  ]),
  ('exam-day', 'fr', 200, 'Jour d''examen', 'Concentration, mémoire et sérénité', array[
    'J''ai révisé, et ma mémoire garde ce que j''ai appris.',
    'Je lis chaque question calmement et je réponds à ce que je sais.',
    'Si je bloque, je respire et je passe à la suite sans stress.',
    'Ma concentration est vive et mes pensées sont claires.',
    'Un examen ne définit ni mon avenir ni ma valeur.',
    'J''ai confiance dans le travail que j''ai déjà fourni.',
    'Je reste dans l''instant, une question à la fois.',
    'Je sors de cet examen avec la fierté du travail accompli.'
  ]),
  ('worthy-as-i-am', 'fr', 200, 'J''ai de la valeur', 'L''estime de soi pour les moments calmes', array[
    'Je mérite l''amour, exactement comme je suis maintenant.',
    'Je n''ai pas besoin de prouver ma valeur à qui que ce soit.',
    'Je me parle avec patience et douceur.',
    'Mes besoins comptent, et je les respecte.',
    'J''ai le droit de prendre ma place.',
    'Je me pardonne ce que je ne savais pas encore.',
    'Chaque jour, je deviens la personne que j''ai envie d''être.',
    'Je mérite la même attention que celle que j''offre si généreusement.'
  ]),
  ('morning-3-min', 'es', 300, 'Por la mañana, 3 min', 'Un comienzo del día sereno y tranquilo', array[
    'Recibo este día con el corazón abierto y sereno.',
    'Tengo todo lo que necesito para vivir este día con calma.',
    'Hoy elijo centrarme en lo que puedo influir.',
    'Mi energía es clara y mi mente está despejada.',
    'Me doy permiso para empezar con suavidad.',
    'Hoy avanzo al ritmo que me sienta bien.',
    'Agradezco este nuevo comienzo.',
    'Confío en mí para afrontar lo que traiga este día.'
  ]),
  ('cant-sleep', 'es', 300, 'No puedo dormir', 'Calma tu mente y concilia el sueño', array[
    'Suelto el día de hoy y todo lo que me pidió.',
    'Mis pensamientos pueden esperar a mañana, ahora toca descansar.',
    'Mi cuerpo está pesado, cálido y a salvo.',
    'Con cada exhalación, suelto un poco más.',
    'Hoy hice suficiente, y esta noche soy suficiente.',
    'El sueño llega fácilmente cuando dejo de perseguirlo.',
    'Aquí estoy a salvo, en este momento, en esta cama.',
    'Mañana despertaré con descanso y energía.'
  ]),
  ('before-a-big-meeting', 'es', 300, 'Antes de una reunión', 'Entra con calma y claridad', array[
    'Me he preparado y sé más de lo que me reconozco.',
    'Mi voz merece ser escuchada en esta sala.',
    'Puedo hacer una pausa, respirar y responder con claridad.',
    'Los nervios significan que me importa, no que me falte preparación.',
    'Hablo despacio, con sencillez y con confianza.',
    'No necesito la perfección para aportar valor aquí.',
    'Llevo calma a cada conversación en la que participo.',
    'Sea cual sea el resultado, aprenderé y creceré con ello.'
  ]),
  ('after-a-hard-day', 'es', 300, 'Tras un día difícil', 'Trátate con cariño esta noche', array[
    'Fue un día difícil, no una vida difícil.',
    'Hoy hice lo mejor que pude con lo que tenía.',
    'Esta noche suelto lo que no puedo cambiar.',
    'Mi valor no se mide por un solo día difícil.',
    'Tengo permiso para descansar sin tener que ganármelo.',
    'Me trato con la misma amabilidad que doy a los demás.',
    'Este sentimiento pasará y todo se hará más ligero.',
    'Me enorgullece haber superado este día.'
  ]),
  ('exam-day', 'es', 300, 'Día de examen', 'Concéntrate, recuerda y mantén la calma', array[
    'Me he preparado y mi mente recuerda lo que aprendí.',
    'Leo cada pregunta con calma y respondo lo que sé.',
    'Si me atasco, respiro y sigo adelante con tranquilidad.',
    'Mi concentración es firme y mis pensamientos son claros.',
    'Un examen no define mi futuro ni mi valor.',
    'Confío en el trabajo que ya he hecho.',
    'Me mantengo presente, una pregunta cada vez.',
    'Salgo de este examen con orgullo por mi esfuerzo.'
  ]),
  ('worthy-as-i-am', 'es', 300, 'Valgo tal como soy', 'Autoestima para los momentos de calma', array[
    'Merezco amor tal como soy ahora mismo.',
    'No necesito demostrarle mi valor a nadie.',
    'Me hablo con paciencia y con cariño.',
    'Mis necesidades importan y las respeto.',
    'Tengo derecho a ocupar mi espacio.',
    'Me perdono por lo que entonces no sabía.',
    'Cada día me acerco más a la persona que quiero ser.',
    'Merezco el mismo cuidado que doy con tanta generosidad.'
  ]),
  ('morning-3-min', 'it', 400, 'Mattina, 3 min', 'Un inizio di giornata calmo e sereno', array[
    'Accolgo questa giornata con il cuore aperto e sereno.',
    'Ho tutto ciò che mi serve per affrontare oggi con calma.',
    'Oggi scelgo di concentrarmi su ciò che posso influenzare.',
    'La mia energia è limpida e la mia mente è pronta.',
    'Mi concedo di iniziare con dolcezza.',
    'Oggi mi muovo al ritmo giusto per me.',
    'Provo gratitudine per questo nuovo inizio.',
    'Confido nella mia capacità di affrontare ciò che questo giorno porterà.'
  ]),
  ('cant-sleep', 'it', 400, 'Non riesco a dormire', 'Calma la mente e lasciati andare al sonno', array[
    'Lascio andare questa giornata e tutto ciò che mi ha chiesto.',
    'I miei pensieri possono aspettare domattina, ora riposo.',
    'Il mio corpo è pesante, caldo e al sicuro.',
    'A ogni espiro, lascio andare un po'' di più.',
    'Oggi ho fatto abbastanza, e stanotte sono abbastanza.',
    'Il sonno arriva da sé quando smetto di inseguirlo.',
    'Qui sono al sicuro, in questo momento, in questo letto.',
    'Domani mi sveglierò con la mente riposata e piena di energia.'
  ]),
  ('before-a-big-meeting', 'it', 400, 'Prima di una riunione', 'Entra con calma e chiarezza', array[
    'Ho lavorato per prepararmi, e so più di quanto penso.',
    'La mia voce merita di essere ascoltata in questa stanza.',
    'Posso fermarmi, respirare e rispondere con chiarezza.',
    'L''agitazione significa che ci tengo, non che non sono all''altezza.',
    'Parlo lentamente, con semplicità e sicurezza.',
    'Non ho bisogno della perfezione per avere valore qui.',
    'Porto calma in ogni conversazione a cui partecipo.',
    'Qualunque sia il risultato, imparerò e crescerò.'
  ]),
  ('after-a-hard-day', 'it', 400, 'Dopo una giornata dura', 'Stasera sii gentile con te', array[
    'È stata una giornata difficile, non una vita difficile.',
    'Oggi ho fatto del mio meglio con ciò che avevo.',
    'Stasera lascio andare ciò che non posso cambiare.',
    'Il mio valore non si misura da una giornata difficile.',
    'Ho il diritto di riposare senza doverlo meritare.',
    'Mi tratto con la stessa gentilezza che riservo agli altri.',
    'Questa sensazione passerà, e tutto sarà più leggero.',
    'Oggi ce l''ho fatta, e questo mi riempie di orgoglio.'
  ]),
  ('exam-day', 'it', 400, 'Giorno d''esame', 'Concentrazione, memoria e calma', array[
    'Ho studiato, e la mia mente ricorda ciò che ho imparato.',
    'Leggo ogni domanda con calma e rispondo a ciò che so.',
    'Se mi blocco, respiro e vado avanti con leggerezza.',
    'La mia concentrazione è viva e i miei pensieri sono chiari.',
    'Un esame non definisce il mio futuro né il mio valore.',
    'Mi fido del lavoro che ho già fatto.',
    'Resto nel presente, una domanda alla volta.',
    'Esco da questo esame con l''orgoglio dell''impegno che ci ho messo.'
  ]),
  ('worthy-as-i-am', 'it', 400, 'Valgo così come sono', 'Autostima per i momenti di quiete', array[
    'Merito amore esattamente come sono adesso.',
    'Non devo dimostrare il mio valore a nessuno.',
    'Mi parlo con pazienza e calore.',
    'I miei bisogni contano, e li rispetto.',
    'Ho il diritto di occupare il mio spazio.',
    'Mi perdono per ciò che allora non sapevo.',
    'Sto diventando la persona che desidero essere.',
    'Merito la stessa cura che offro così generosamente.'
  ]),
  ('morning-3-min', 'nl', 500, 'Ochtend, 3 min', 'Een rustige, stabiele start van de dag', array[
    'Ik begroet deze dag met een open en rustig hart.',
    'Ik heb alles wat ik nodig heb om vandaag kalm tegemoet te treden.',
    'Vandaag richt ik me op wat ik kan beïnvloeden.',
    'Mijn energie is helder en mijn hoofd is er klaar voor.',
    'Ik geef mezelf toestemming om rustig te beginnen.',
    'Vandaag beweeg ik in een tempo dat goed voelt voor mij.',
    'Ik ben dankbaar voor dit frisse begin.',
    'Ik vertrouw erop dat ik aankan wat deze dag ook brengt.'
  ]),
  ('cant-sleep', 'nl', 500, 'Kan niet slapen', 'Laat je drukke hoofd tot rust komen', array[
    'Ik laat vandaag los, en alles wat het van me vroeg.',
    'Mijn gedachten kunnen wachten tot morgen, nu rust ik.',
    'Mijn lichaam is zwaar, warm en veilig.',
    'Met elke uitademing laat ik een beetje meer los.',
    'Ik heb vandaag genoeg gedaan, en vanavond ben ik genoeg.',
    'De slaap komt vanzelf als ik er niet meer achteraan jaag.',
    'Ik ben hier veilig, in dit moment, in dit bed.',
    'Morgen begin ik uitgerust en vol energie.'
  ]),
  ('before-a-big-meeting', 'nl', 500, 'Voor een grote meeting', 'Ga met rust en helderheid naar binnen', array[
    'Ik ben voorbereid, en ik weet meer dan ik mezelf toedicht.',
    'Mijn stem verdient het om gehoord te worden in deze ruimte.',
    'Ik kan even pauzeren, ademen en helder antwoorden.',
    'Zenuwen betekenen dat het me iets kan schelen, niet dat ik niet klaar ben.',
    'Ik spreek langzaam, eenvoudig en vol vertrouwen.',
    'Ik hoef niet perfect te zijn om hier waardevol te zijn.',
    'Ik breng rust in elk gesprek waar ik aan deelneem.',
    'Wat de uitkomst ook is, ik leer en groei ervan.'
  ]),
  ('after-a-hard-day', 'nl', 500, 'Na een zware dag', 'Wees vanavond lief voor jezelf', array[
    'Het was een zware dag, geen zwaar leven.',
    'Ik heb vandaag mijn best gedaan met wat ik had.',
    'Vanavond laat ik los wat ik niet kan veranderen.',
    'Mijn waarde wordt niet bepaald door één moeilijke dag.',
    'Ik mag rusten zonder het te hoeven verdienen.',
    'Ik behandel mezelf met dezelfde vriendelijkheid die ik anderen geef.',
    'Dit gevoel gaat voorbij, en ik zal me lichter voelen.',
    'Ik ben trots op mezelf dat ik deze dag ben doorgekomen.'
  ]),
  ('exam-day', 'nl', 500, 'Examendag', 'Gefocust, helder en kalm blijven', array[
    'Ik heb me voorbereid, en mijn hoofd onthoudt wat ik heb geleerd.',
    'Ik lees elke vraag rustig en beantwoord wat ik weet.',
    'Als ik vastloop, adem ik even in en ga ik rustig verder.',
    'Mijn focus is scherp en mijn gedachten zijn helder.',
    'Eén examen bepaalt niet mijn toekomst of mijn waarde.',
    'Ik vertrouw op het werk dat ik al heb gedaan.',
    'Ik blijf in het moment, één vraag tegelijk.',
    'Ik verlaat dit examen trots op mijn inzet.'
  ]),
  ('worthy-as-i-am', 'nl', 500, 'Waardevol zoals ik ben', 'Eigenwaarde voor de stille momenten', array[
    'Ik ben liefde waard, precies zoals ik nu ben.',
    'Ik hoef mijn waarde aan niemand te bewijzen.',
    'Ik praat met geduld en warmte tegen mezelf.',
    'Mijn behoeften doen ertoe, en ik respecteer ze.',
    'Ik mag ruimte innemen.',
    'Ik vergeef mezelf wat ik toen nog niet wist.',
    'Ik word iemand op wie ik trots ben.',
    'Ik verdien dezelfde zorg die ik zo graag aan anderen geef.'
  ]),
  ('morning-3-min', 'pt-br', 600, 'Manhã, 3 min', 'Um começo de dia tranquilo e firme', array[
    'Eu recebo este dia com o coração aberto e tranquilo.',
    'Tenho tudo o que preciso para encarar o dia de hoje com calma.',
    'Hoje eu escolho focar no que está ao meu alcance.',
    'Sinto minha energia clara e minha mente pronta.',
    'Eu me dou permissão para começar devagar.',
    'Hoje eu sigo no ritmo que faz sentido para mim.',
    'Sinto gratidão por este novo começo.',
    'Confio em mim para lidar com o que este dia trouxer.'
  ]),
  ('cant-sleep', 'pt-br', 600, 'Não consigo dormir', 'Acalme a mente agitada e pegue no sono', array[
    'Eu solto o dia de hoje e tudo o que ele me cobrou.',
    'Meus pensamentos podem esperar até amanhã; agora eu descanso.',
    'Meu corpo está pesado, quentinho e em segurança.',
    'A cada vez que solto o ar, eu relaxo um pouco mais.',
    'Fiz o suficiente hoje, e esta noite eu sou suficiente.',
    'O sono vem fácil quando eu paro de correr atrás dele.',
    'Aqui eu estou em segurança, agora, nesta cama.',
    'Amanhã eu acordo com o corpo descansado e cheio de energia.'
  ]),
  ('before-a-big-meeting', 'pt-br', 600, 'Antes de uma reunião', 'Entre com os pés no chão e a mente clara', array[
    'Eu me preparei e sei mais do que costumo reconhecer.',
    'Minha voz merece ser ouvida nesta sala.',
    'Eu posso parar, respirar e responder com clareza.',
    'O nervosismo mostra que eu me importo, não que me falta preparo.',
    'Eu falo devagar, de forma simples e com confiança.',
    'Eu não preciso fazer tudo perfeito para ter valor aqui.',
    'Eu levo tranquilidade para toda conversa em que eu entro.',
    'Seja qual for o resultado, vou aprender e crescer com isso.'
  ]),
  ('after-a-hard-day', 'pt-br', 600, 'Depois de um dia duro', 'Seja gentil com você esta noite', array[
    'Foi um dia difícil, não uma vida difícil.',
    'Hoje eu fiz o meu melhor com o que eu tinha.',
    'Esta noite eu abro mão do que não posso mudar.',
    'Meu valor não se mede por um dia difícil.',
    'Eu posso descansar sem precisar merecer isso.',
    'Eu me trato com a mesma gentileza que ofereço aos outros.',
    'Esse sentimento vai passar, e eu vou me sentir mais leve.',
    'Sinto orgulho de mim por ter enfrentado o dia de hoje.'
  ]),
  ('exam-day', 'pt-br', 600, 'Dia de prova', 'Foco, memória e calma até o fim', array[
    'Eu me preparei, e minha mente lembra o que aprendi.',
    'Leio cada questão com calma e respondo o que eu sei.',
    'Se eu travar, respiro e passo para a próxima com leveza.',
    'Meu foco está afiado e meus pensamentos estão claros.',
    'Uma prova não define meu futuro nem meu valor.',
    'Eu confio em todo o esforço que já fiz.',
    'Eu fico no presente, uma questão de cada vez.',
    'Saio desta prova com orgulho do meu esforço.'
  ]),
  ('worthy-as-i-am', 'pt-br', 600, 'Valho do jeito que sou', 'Autoestima para os momentos de calma', array[
    'Eu mereço amor do jeito que eu sou agora.',
    'Não preciso provar meu valor para ninguém.',
    'Eu converso comigo com paciência e carinho.',
    'Minhas necessidades importam, e eu as respeito.',
    'Eu tenho o direito de ocupar espaço.',
    'Eu me perdoo pelo que eu não sabia na época.',
    'Estou me tornando alguém de quem me orgulho.',
    'Eu mereço o mesmo cuidado que ofereço tão facilmente.'
  ]),
  ('morning-3-min', 'pt-pt', 700, 'Manhã, 3 min', 'Um início de dia calmo e sereno', array[
    'Recebo este dia de coração aberto e sereno.',
    'Tenho tudo aquilo de que preciso para enfrentar o dia com calma.',
    'Hoje escolho concentrar-me no que está ao meu alcance.',
    'A minha energia está clara e a minha mente está pronta.',
    'Dou-me permissão para começar devagar.',
    'Hoje sigo ao ritmo que é certo para mim.',
    'Sinto gratidão por este novo início.',
    'Confio em mim para lidar com tudo o que este dia trouxer.'
  ]),
  ('cant-sleep', 'pt-pt', 700, 'Não consigo dormir', 'Acalma a mente agitada e adormece', array[
    'Deixo para trás o dia de hoje e tudo o que me exigiu.',
    'Os meus pensamentos podem esperar pela manhã; agora descanso.',
    'O meu corpo está pesado, quente e em segurança.',
    'Sempre que expiro, deixo-me ir um pouco mais.',
    'Hoje fiz o suficiente, e esta noite sou suficiente.',
    'O sono chega facilmente quando deixo de o perseguir.',
    'Estou em segurança aqui, neste momento, nesta cama.',
    'Amanhã vou acordar com o corpo descansado e cheio de energia.'
  ]),
  ('before-a-big-meeting', 'pt-pt', 700, 'Antes de uma reunião', 'Entra com os pés no chão e a mente clara', array[
    'Preparei-me e sei mais do que costumo admitir.',
    'A minha voz merece ser ouvida nesta sala.',
    'Posso fazer uma pausa, respirar e responder com clareza.',
    'O nervosismo mostra que isto me importa, não que me falte preparação.',
    'Falo devagar, com simplicidade e com confiança.',
    'Não preciso de perfeição para ter valor aqui.',
    'Levo serenidade a cada conversa em que participo.',
    'Seja qual for o resultado, vou aprender e crescer com isto.'
  ]),
  ('after-a-hard-day', 'pt-pt', 700, 'Após um dia difícil', 'Sê gentil contigo esta noite', array[
    'Foi um dia difícil, não uma vida difícil.',
    'Hoje fiz o melhor que podia com o que tinha.',
    'Esta noite deixo ir aquilo que não posso mudar.',
    'O meu valor não se mede por um dia difícil.',
    'Tenho direito a descansar sem ter de o merecer.',
    'Trato-me com a mesma bondade que dou aos outros.',
    'Este sentimento vai passar e vou sentir-me mais leve.',
    'Tenho orgulho em mim por ter aguentado o dia de hoje.'
  ]),
  ('exam-day', 'pt-pt', 700, 'Dia de exame', 'Foco, memória e calma até ao fim', array[
    'Preparei-me, e a minha mente lembra-se do que aprendi.',
    'Leio cada pergunta com calma e respondo ao que sei.',
    'Se não souber uma, respiro e passo à seguinte com calma.',
    'O meu foco está apurado e os meus pensamentos estão claros.',
    'Um exame não define o meu futuro nem o meu valor.',
    'Confio em todo o trabalho que já fiz.',
    'Mantenho-me no presente, uma pergunta de cada vez.',
    'Saio deste exame com orgulho no meu esforço.'
  ]),
  ('worthy-as-i-am', 'pt-pt', 700, 'Valho tal como sou', 'Amor-próprio para os momentos de sossego', array[
    'Mereço amor exatamente como sou neste momento.',
    'Não tenho de provar o meu valor a ninguém.',
    'Falo comigo com paciência e ternura.',
    'As minhas necessidades importam e eu respeito-as.',
    'Tenho direito a ocupar o meu espaço.',
    'Perdoo-me por aquilo que não sabia na altura.',
    'Estou a tornar-me alguém de quem me orgulho.',
    'Mereço o mesmo cuidado que dou aos outros de tão bom grado.'
  ]),
  ('morning-3-min', 'ru', 800, 'Утро, 3 мин', 'Спокойное и уверенное начало дня', array[
    'Я встречаю этот день с открытым и спокойным сердцем.',
    'У меня есть всё, чтобы прожить этот день спокойно.',
    'Сегодня я выбираю думать о том, что зависит от меня.',
    'Моя энергия ясная, а голова готова к новому дню.',
    'Я разрешаю себе начать день мягко.',
    'Сегодня я живу в том темпе, который подходит мне.',
    'Я чувствую благодарность за это новое начало.',
    'Я верю, что справлюсь со всем, что принесёт этот день.'
  ]),
  ('cant-sleep', 'ru', 800, 'Не могу уснуть', 'Успокой мысли и засыпай', array[
    'Я отпускаю этот день и всё, что он от меня требовал.',
    'Мысли подождут до утра, а сейчас я отдыхаю.',
    'Моё тело тяжёлое, тёплое и в безопасности.',
    'С каждым выдохом я расслабляюсь ещё немного.',
    'Сегодня сделано достаточно, и этой ночью мне достаточно просто быть.',
    'Сон приходит легко, когда я перестаю за ним гнаться.',
    'Здесь, в этот момент, в этой постели, я в безопасности.',
    'Завтра я проснусь с новыми силами и свежей головой.'
  ]),
  ('before-a-big-meeting', 'ru', 800, 'Перед важной встречей', 'Входи спокойно и с ясной головой', array[
    'Подготовка позади, и я знаю больше, чем мне кажется.',
    'Мой голос достоин того, чтобы его услышали.',
    'Я могу сделать паузу, вдохнуть и ответить ясно.',
    'Волнение значит, что мне это важно, а не что мне не хватает подготовки.',
    'Я говорю медленно, просто и уверенно.',
    'Моя ценность здесь не зависит от безупречности.',
    'Я приношу спокойствие в каждый разговор.',
    'Каким бы ни был итог, я извлеку из него опыт и стану сильнее.'
  ]),
  ('after-a-hard-day', 'ru', 800, 'После тяжёлого дня', 'Сегодня будь к себе добрее', array[
    'Это был тяжёлый день, а не тяжёлая жизнь.',
    'Всё, что было сегодня в моих силах, сделано.',
    'Этой ночью я отпускаю то, что не могу изменить.',
    'Один тяжёлый день не определяет мою ценность.',
    'Мне можно отдыхать, не заслуживая этого.',
    'Я отношусь к себе так же бережно, как к другим.',
    'Это чувство пройдёт, и мне станет легче.',
    'Я горжусь собой: сегодняшний день позади.'
  ]),
  ('exam-day', 'ru', 800, 'День экзамена', 'Фокус, память и спокойствие', array[
    'Подготовка позади, и память хранит всё изученное.',
    'Я спокойно читаю каждый вопрос и отвечаю на то, что знаю.',
    'Если что-то не идёт, я делаю вдох и спокойно иду дальше.',
    'Внимание острое, а мысли ясные.',
    'Один экзамен не определяет ни моё будущее, ни мою ценность.',
    'Я доверяю той работе, что уже проделана.',
    'Я остаюсь в моменте и решаю вопросы по одному.',
    'Я выхожу с экзамена с гордостью за свои старания.'
  ]),
  ('worthy-as-i-am', 'ru', 800, 'Ценю себя', 'Любовь к себе в тихие минуты', array[
    'Я заслуживаю любви прямо сейчас, без всяких условий.',
    'Мне не нужно никому доказывать свою ценность.',
    'Я говорю с собой терпеливо и тепло.',
    'Мои потребности важны, и я их уважаю.',
    'Мне можно занимать своё место.',
    'Я прощаю себя: тогда мне многое было неизвестно.',
    'Я становлюсь человеком, которым горжусь.',
    'Я заслуживаю той же заботы, которую так щедро дарю другим.'
  ]),
  ('morning-3-min', 'tr', 900, 'Sabah, 3 dk', 'Güne sakin ve dengeli bir başlangıç', array[
    'Bu güne açık ve dingin bir kalple merhaba diyorum.',
    'Bugünü sakinlikle karşılamak için ihtiyacım olan her şeye sahibim.',
    'Bugün etkileyebileceğim şeylere odaklanmayı seçiyorum.',
    'Enerjim berrak, zihnim hazır.',
    'Güne yavaş yavaş başlamama izin veriyorum.',
    'Bugün bana iyi gelen bir hızda ilerliyorum.',
    'Bu yeni başlangıç için minnettarım.',
    'Bu günün getireceği her şeyle başa çıkabileceğime güveniyorum.'
  ]),
  ('cant-sleep', 'tr', 900, 'Uyuyamıyorum', 'Zihnini sakinleştir ve uykuya dal', array[
    'Bugünü ve benden istediği her şeyi bırakıyorum.',
    'Düşüncelerim sabaha kadar bekleyebilir; şimdi dinleniyorum.',
    'Bedenim ağır, sıcak ve güvende.',
    'Her nefes verişimde biraz daha gevşiyorum.',
    'Bugün yeterince şey yaptım, bu gece de olduğum gibi yeterliyim.',
    'Uykunun peşinden koşmayı bıraktığımda uyku kendiliğinden geliyor.',
    'Burada, bu anda, bu yatakta güvendeyim.',
    'Yarın dinlenmiş ve hazır uyanacağım.'
  ]),
  ('before-a-big-meeting', 'tr', 900, 'Önemli toplantı öncesi', 'Sakin ve net bir zihinle içeri gir', array[
    'Hazırlıklıyım ve sandığımdan çok daha fazlasını biliyorum.',
    'Sesim bu odada duyulmayı hak ediyor.',
    'Durabilir, nefes alabilir ve net bir şekilde cevap verebilirim.',
    'Heyecanım önemsediğimi gösterir, hazır olmadığımı değil.',
    'Yavaş, sade ve özgüvenle konuşuyorum.',
    'Burada değerli olmak için mükemmel olmam gerekmiyor.',
    'Katıldığım her sohbete huzur getiriyorum.',
    'Sonuç ne olursa olsun, bundan öğrenip büyüyeceğim.'
  ]),
  ('after-a-hard-day', 'tr', 900, 'Zor bir günün ardından', 'Bu gece kendine nazik davran', array[
    'Zor bir gündü, zor bir hayat değil.',
    'Bugün elimdekilerle elimden gelenin en iyisini yaptım.',
    'Bu gece değiştiremeyeceğim şeyleri bırakıyorum.',
    'Değerim zor geçen tek bir günle ölçülmez.',
    'Hiçbir şey kanıtlamadan dinlenmeye hakkım var.',
    'Kendime, başkalarına gösterdiğim şefkatle davranıyorum.',
    'Bu his geçecek ve kendimi daha hafif hissedeceğim.',
    'Bugünü atlattığım için kendimle gurur duyuyorum.'
  ]),
  ('exam-day', 'tr', 900, 'Sınav günü', 'Odaklan, hatırla ve sakin kal', array[
    'Hazırlandım ve zihnim öğrendiklerimi hatırlıyor.',
    'Her soruyu sakince okuyor ve bildiklerimi yanıtlıyorum.',
    'Takılırsam nefes alıyor ve rahatça devam ediyorum.',
    'Odağım keskin, düşüncelerim berrak.',
    'Tek bir sınav ne geleceğimi ne de değerimi belirler.',
    'Şimdiye kadar verdiğim emeğe güveniyorum.',
    'Her seferinde tek bir soruya odaklanıp anda kalıyorum.',
    'Bu sınavdan emeğimle gurur duyarak çıkıyorum.'
  ]),
  ('worthy-as-i-am', 'tr', 900, 'Olduğum gibi değerli', 'Sessiz anlar için öz değer', array[
    'Şu anki hâlimle, olduğum gibi sevilmeyi hak ediyorum.',
    'Değerimi kimseye kanıtlamak zorunda değilim.',
    'Kendimle sabır ve şefkatle konuşuyorum.',
    'İhtiyaçlarım önemli ve onlara saygı duyuyorum.',
    'Bu dünyada yer kaplamaya hakkım var.',
    'O zamanlar bilmediklerim için kendimi affediyorum.',
    'Gurur duyduğum biri oluyorum.',
    'Başkalarına cömertçe verdiğim özeni ben de hak ediyorum.'
  ]),
  ('morning-3-min', 'ar', 1000, 'الصباح، 3 دقائق', 'بداية هادئة وثابتة لليوم', array[
    'أستقبل هذا اليوم بقلب منفتح وثابت.',
    'لديّ كل ما أحتاجه لأواجه اليوم بهدوء.',
    'أختار اليوم أن أركّز على ما أستطيع التأثير فيه.',
    'طاقتي صافية، وذهني مستعد.',
    'أسمح لنفسي بأن أبدأ بلطف وهدوء.',
    'اليوم أمضي بالإيقاع الذي يناسبني.',
    'أشعر بالامتنان لهذه البداية الجديدة.',
    'أثق بقدرتي على التعامل مع كل ما يحمله هذا اليوم.'
  ]),
  ('cant-sleep', 'ar', 1000, 'لا أستطيع النوم', 'تهدئة الذهن المشغول والاستسلام للنوم', array[
    'أتخلّى عن هذا اليوم وعن كل ما طلبه مني.',
    'أفكاري يمكنها أن تنتظر حتى الصباح، أما الآن فأرتاح.',
    'جسدي ثقيل ودافئ وفي أمان.',
    'مع كل زفير، أسترخي أكثر قليلًا.',
    'قدّمتُ اليوم ما يكفي، ووجودي كما أنا يكفي الليلة.',
    'يأتيني النوم بسهولة حين أتوقف عن ملاحقته.',
    'أنا في أمان هنا، في هذه اللحظة، في هذا السرير.',
    'غدًا أستيقظ بجسد مرتاح وطاقة متجددة.'
  ]),
  ('before-a-big-meeting', 'ar', 1000, 'قبل اجتماع مهم', 'حضور ثابت وذهن صافٍ', array[
    'استعددتُ جيدًا، وأعرف أكثر مما أظن.',
    'صوتي يستحق أن يُسمَع في هذه القاعة.',
    'أستطيع أن أتوقف وأتنفس وأجيب بوضوح.',
    'توتري يعني أن الأمر يهمّني، لا أن استعدادي ناقص.',
    'أتحدث ببطء وبساطة وثقة.',
    'قيمتي هنا لا تتوقف على الكمال.',
    'أحمل الهدوء إلى كل حديث أشارك فيه.',
    'مهما كانت النتيجة، سأتعلم منها وأنمو.'
  ]),
  ('after-a-hard-day', 'ar', 1000, 'بعد يوم صعب', 'رفقًا بنفسك هذه الليلة', array[
    'كان يومًا صعبًا، لا حياةً صعبة.',
    'بذلتُ اليوم أفضل ما لديّ بما كان متاحًا لي.',
    'الليلة أتخلّى عمّا لا أستطيع تغييره.',
    'قيمتي لا يحددها يوم واحد صعب.',
    'من حقي أن أرتاح دون أي شروط.',
    'أعامل نفسي باللطف نفسه الذي أمنحه للآخرين.',
    'هذا الشعور سيمضي، وسأشعر بخفة أكبر.',
    'أفخر بنفسي لأنني تجاوزت هذا اليوم.'
  ]),
  ('exam-day', 'ar', 1000, 'يوم الامتحان', 'تركيز وتذكّر وثبات', array[
    'استعددتُ جيدًا، وذهني يتذكر ما تعلّمته.',
    'أقرأ كل سؤال بهدوء وأجيب عمّا أعرفه.',
    'إن تعثّرتُ، أتنفس وأنتقل إلى السؤال التالي بسهولة.',
    'تركيزي حاد وأفكاري واضحة.',
    'امتحان واحد لا يحدد مستقبلي ولا قيمتي.',
    'أثق بالجهد الذي بذلته بالفعل.',
    'أبقى في اللحظة، مع سؤال واحد في كل مرة.',
    'أغادر هذا الامتحان بفخر بما بذلته من جهد.'
  ]),
  ('worthy-as-i-am', 'ar', 1000, 'أستحق كما أنا', 'تقدير الذات للحظات الهادئة', array[
    'أستحق الحب تمامًا كما أنا الآن.',
    'لا أحتاج إلى إثبات قيمتي لأحد.',
    'أحدّث نفسي بصبر ودفء.',
    'احتياجاتي مهمة، وأنا أحترمها.',
    'من حقي أن آخذ مساحتي.',
    'أسامح نفسي على ما لم أكن أعرفه حينها.',
    'أصبح شيئًا فشيئًا شخصًا أفخر به.',
    'أستحق الرعاية نفسها التي أمنحها بسخاء.'
  ]),
  ('morning-3-min', 'ja', 1100, '朝の3分', '穏やかで落ち着いた一日のはじまり', array[
    '開かれた穏やかな心で、今日という日を迎える。',
    '今日を落ち着いて過ごすために必要なものは、もう全部そろっている。',
    '今日は、自分の力で変えられることに目を向ける。',
    '私のエネルギーは澄んでいて、心の準備もできている。',
    'ゆっくり始めていいと、自分に許してあげる。',
    '今日は、自分にちょうどいいペースで進んでいく。',
    'この新しいはじまりに感謝している。',
    '今日何が起きても、私なら大丈夫だと信じている。'
  ]),
  ('cant-sleep', 'ja', 1100, '眠れない夜に', 'ざわつく心をしずめて、眠りへ', array[
    '今日のことも、今日求められたことも、全部手放す。',
    '考えごとは朝まで待ってくれるから、今はただ休む。',
    '体は重く、あたたかく、安心している。',
    '息を吐くたびに、少しずつ力が抜けていく。',
    '今日はもう十分がんばったし、今夜の私はこのままで十分。',
    '眠ろうと追いかけるのをやめれば、眠りは自然にやってくる。',
    '今この瞬間、このベッドの上で、私は守られている。',
    'ぐっすり休んだ私で、明日を迎えられる。'
  ]),
  ('before-a-big-meeting', 'ja', 1100, '大事な会議の前に', '地に足をつけて、すっきりと臨む', array[
    '準備はできているし、私は自分が思っている以上によく分かっている。',
    'この場で、私の声には聞いてもらう価値がある。',
    '一度間を置いて、呼吸をして、はっきりと答えればいい。',
    '緊張するのは大切に思っているからで、準備不足だからじゃない。',
    'ゆっくり、シンプルに、自信を持って話す。',
    '完璧じゃなくても、ここでの私には価値がある。',
    'どの会話にも、私は穏やかさを運んでいく。',
    '結果がどうであれ、そこから学んで成長していく。'
  ]),
  ('after-a-hard-day', 'ja', 1100, 'つらい一日のあとに', '今夜は自分にやさしく', array[
    'つらかったのは今日一日で、人生全部じゃない。',
    '今日は、持てる力で精いっぱいやった。',
    '変えられないことは、今夜は手放す。',
    'つらい一日で、私の価値が決まるわけじゃない。',
    '何かを成し遂げなくても、休んでいい。',
    '人に向けているやさしさを、自分にも向けてあげる。',
    'この気持ちはいつか過ぎて、心は軽くなっていく。',
    '今日を乗り越えた自分を誇りに思う。'
  ]),
  ('exam-day', 'ja', 1100, '試験の日', '集中して、思い出して、落ち着いて', array[
    'しっかり準備してきたし、学んだことはちゃんと覚えている。',
    '一問ずつ落ち着いて読み、分かることから答えていく。',
    'つまずいたら深呼吸して、軽やかに次へ進む。',
    '集中力は研ぎ澄まされ、考えはすっきりしている。',
    'ひとつの試験で、私の未来や価値は決まらない。',
    'これまで積み重ねてきた努力を信じている。',
    '目の前の一問だけに、心を向け続ける。',
    '精いっぱいやった自分を誇りに思って、試験を終える。'
  ]),
  ('worthy-as-i-am', 'ja', 1100, 'ありのままの私で', '静かなひとときに、自分の価値を', array[
    '今のままの私で、愛される価値がある。',
    '誰かに自分の価値を証明しなくていい。',
    '自分には、辛抱強く、あたたかく話しかける。',
    '自分の望みは大切なもので、ちゃんと大事にする。',
    '私はここにいていいし、自分の居場所を持っていい。',
    'あのころ知らなかったことについて、自分を許す。',
    '私は、誇れる自分になりつつある。',
    '人に惜しみなく向けている思いやりを、私も受け取っていい。'
  ]),
  ('morning-3-min', 'ko', 1200, '아침 3분', '차분하고 안정적인 하루의 시작', array[
    '나는 열린 마음으로 차분하게 오늘을 맞이해.',
    '오늘을 차분하게 보내는 데 필요한 건 이미 다 갖고 있어.',
    '오늘은 내가 바꿀 수 있는 것에 집중하기로 해.',
    '내 에너지는 맑고, 마음은 준비가 되어 있어.',
    '천천히 시작해도 괜찮다고 나에게 허락해.',
    '오늘은 나에게 맞는 속도로 움직여.',
    '이 새로운 시작에 감사해.',
    '오늘 무슨 일이 생겨도 잘 해낼 수 있다고 나를 믿어.'
  ]),
  ('cant-sleep', 'ko', 1200, '잠이 안 올 때', '복잡한 마음을 가라앉히고 잠들기', array[
    '오늘 하루와 오늘 나에게 요구된 모든 것을 내려놓아.',
    '생각들은 아침까지 기다려도 되니까, 지금은 그냥 쉬어.',
    '내 몸은 묵직하고, 따뜻하고, 안전해.',
    '숨을 내쉴 때마다 조금씩 더 내려놓아.',
    '오늘 충분히 애썼고, 오늘 밤의 나는 이대로 충분해.',
    '잠을 쫓아가지 않으면 잠은 저절로 찾아와.',
    '지금 이 순간, 이 침대 위에서 나는 안전해.',
    '푹 쉬고 나면 내일을 준비된 마음으로 맞이할 거야.'
  ]),
  ('before-a-big-meeting', 'ko', 1200, '중요한 회의 전에', '차분하고 또렷하게 들어서기', array[
    '나는 준비되어 있고, 생각보다 훨씬 많이 알고 있어.',
    '이 자리에서 내 목소리는 들을 가치가 있어.',
    '잠깐 멈추고, 숨 쉬고, 또렷하게 대답하면 돼.',
    '긴장된다는 건 신경 쓴다는 뜻이지, 준비가 안 됐다는 뜻이 아니야.',
    '나는 천천히, 쉽게, 자신 있게 말해.',
    '완벽하지 않아도 나는 이 자리에서 충분히 가치 있어.',
    '나는 함께하는 모든 대화에 차분함을 더해.',
    '결과가 어떻든, 나는 그 안에서 배우고 성장할 거야.'
  ]),
  ('after-a-hard-day', 'ko', 1200, '힘든 하루 끝에', '오늘 밤은 나에게 다정하게', array[
    '힘들었던 건 오늘 하루였지, 내 인생 전체가 아니야.',
    '오늘 나는 가진 것으로 최선을 다했어.',
    '오늘 밤은 바꿀 수 없는 일을 내려놓아.',
    '힘든 하루 하나로 내 가치가 정해지지 않아.',
    '뭔가를 해내지 않아도 나는 쉬어도 돼.',
    '다른 사람에게 건네는 다정함으로 나 자신을 대해.',
    '이 기분은 지나갈 거고, 마음은 한결 가벼워질 거야.',
    '오늘을 잘 버텨 낸 내가 자랑스러워.'
  ]),
  ('exam-day', 'ko', 1200, '시험 날', '집중하고, 떠올리고, 차분하게', array[
    '나는 준비했고, 배운 것들은 내 머릿속에 다 남아 있어.',
    '문제를 하나하나 차분히 읽고, 아는 것부터 답해.',
    '막히면 숨을 고르고 가볍게 다음으로 넘어가.',
    '내 집중력은 또렷하고, 생각은 맑아.',
    '시험 하나가 내 미래나 내 가치를 정하지 않아.',
    '지금까지 쏟아 온 노력을 믿어.',
    '한 번에 한 문제씩, 지금 이 순간에 머물러.',
    '최선을 다한 나를 자랑스럽게 여기며 시험을 마쳐.'
  ]),
  ('worthy-as-i-am', 'ko', 1200, '있는 그대로 소중해', '조용한 순간, 나의 가치를 느끼며', array[
    '나는 지금 모습 그대로 사랑받을 자격이 있어.',
    '누구에게도 내 가치를 증명할 필요는 없어.',
    '나는 나에게 인내심 있고 따뜻하게 말해.',
    '내가 원하는 것도 소중하니까, 나는 그것을 존중해.',
    '나는 내 자리를 차지해도 괜찮아.',
    '그때 몰랐던 것에 대해 나를 용서해.',
    '나는 스스로 자랑스러운 사람이 되어 가고 있어.',
    '내가 아낌없이 건네는 그 보살핌을 나도 받을 자격이 있어.'
  ]),
  ('morning-3-min', 'zh-hans', 1300, '早晨 3 分钟', '平静、安稳地开始新的一天', array[
    '我用敞开而安稳的心，迎接今天。',
    '我已经拥有平静面对今天所需要的一切。',
    '今天，我选择专注于我能影响的事。',
    '我精神清爽，心里已经准备好了。',
    '我允许自己轻轻地、慢慢地开始。',
    '今天，我按照适合自己的节奏前进。',
    '我感谢这个崭新的开始。',
    '我相信自己能应对今天到来的一切。'
  ]),
  ('cant-sleep', 'zh-hans', 1300, '睡不着时', '让纷乱的思绪安静下来，慢慢入睡', array[
    '我放下今天，也放下今天对我的所有要求。',
    '那些念头可以等到明天早上，现在我只需要休息。',
    '我的身体沉沉的、暖暖的，很安全。',
    '每一次呼气，我都再放下一点点。',
    '今天我做得够多了，今晚的我已经足够好。',
    '当我不再追着睡意跑，睡意就会自然到来。',
    '此时此刻，躺在这张床上，我是安全的。',
    '好好休息之后，我会从容地迎接明天。'
  ]),
  ('before-a-big-meeting', 'zh-hans', 1300, '重要会议前', '沉稳、清晰地走进会议室', array[
    '我已经准备好了，而且我懂的比我以为的更多。',
    '在这个房间里，我的声音值得被听见。',
    '我可以停一停，深呼吸，然后清楚地回答。',
    '紧张说明我在乎，并不代表我没准备好。',
    '我说话慢一点、简单一点、自信一点。',
    '我不必完美，也能在这里发挥价值。',
    '我把平静带进我参与的每一次对话。',
    '无论结果如何，我都会从中学习和成长。'
  ]),
  ('after-a-hard-day', 'zh-hans', 1300, '难熬的一天之后', '今晚对自己温柔一点', array[
    '难熬的只是今天，不是整个人生。',
    '今天我已经用手上的一切尽力了。',
    '今晚，我放下那些无法改变的事。',
    '一个难熬的日子，衡量不了我的价值。',
    '我不需要做成什么，也可以好好休息。',
    '我像善待别人那样，温柔地对待自己。',
    '这种感觉会过去，我会慢慢轻松起来。',
    '我为熬过今天的自己感到骄傲。'
  ]),
  ('exam-day', 'zh-hans', 1300, '考试当天', '专注、回想、保持沉稳', array[
    '我已经做好准备，学过的内容都记在脑子里。',
    '我平静地读每一道题，先答我会的。',
    '如果卡住了，我就深呼吸，轻松地往下做。',
    '我的注意力很集中，思路很清晰。',
    '一场考试决定不了我的未来，也决定不了我的价值。',
    '我相信自己之前付出的努力。',
    '我专注当下，一次只做一道题。',
    '我带着对自己努力的骄傲走出考场。'
  ]),
  ('worthy-as-i-am', 'zh-hans', 1300, '我本就值得', '在安静的时刻，感受自己的价值', array[
    '此刻的我，本来的样子，就值得被爱。',
    '我不需要向任何人证明自己的价值。',
    '我用耐心和温暖跟自己说话。',
    '我的需要很重要，我会好好重视它们。',
    '我可以大大方方地拥有属于自己的位置。',
    '我原谅过去那个还不懂的自己。',
    '我正在成为让自己骄傲的人。',
    '我毫无保留地关心别人，我也值得同样的关心。'
  ]),
  ('morning-3-min', 'zh-hant', 1400, '早晨 3 分鐘', '平靜、安穩地展開新的一天', array[
    '我用敞開而安穩的心，迎接今天。',
    '我已經擁有平靜面對今天所需要的一切。',
    '今天，我選擇專注在我能影響的事情上。',
    '我精神清爽，心裡已經準備好了。',
    '我允許自己輕輕地、慢慢地開始。',
    '今天，我用適合自己的步調前進。',
    '我感謝這個嶄新的開始。',
    '我相信自己能面對今天帶來的一切。'
  ]),
  ('cant-sleep', 'zh-hant', 1400, '睡不著時', '讓紛亂的思緒安靜下來，慢慢入睡', array[
    '我放下今天，也放下今天對我的所有要求。',
    '那些想法可以等到明天早上，現在我只要好好休息。',
    '我的身體沉沉的、暖暖的，很安全。',
    '每一次吐氣，我都再放下一點點。',
    '今天我做得夠多了，今晚的我已經夠好了。',
    '當我不再追著睡意跑，睡意就會自然來找我。',
    '此時此刻，躺在這張床上，我是安全的。',
    '好好休息之後，我會從容地迎接明天。'
  ]),
  ('before-a-big-meeting', 'zh-hant', 1400, '重要會議前', '沉穩、清晰地走進會議室', array[
    '我已經準備好了，而且我懂的比我以為的還多。',
    '在這個場合，我的聲音值得被聽見。',
    '我可以停一下，深呼吸，再清楚地回答。',
    '緊張代表我在乎，不代表我還沒準備好。',
    '我說話慢一點、簡單一點、有自信一點。',
    '我不需要完美，也能在這裡發揮價值。',
    '我把平靜帶進我參與的每一段對話。',
    '不管結果如何，我都會從中學習、成長。'
  ]),
  ('after-a-hard-day', 'zh-hant', 1400, '難熬的一天過後', '今晚對自己溫柔一點', array[
    '難熬的只是今天，不是整個人生。',
    '今天我已經用手邊有的一切盡力了。',
    '今晚，我放下那些無法改變的事。',
    '一個難熬的日子，衡量不了我的價值。',
    '我不需要做出什麼成績，也可以好好休息。',
    '我像善待別人那樣，溫柔地對待自己。',
    '這種感覺會過去，我會慢慢輕鬆起來。',
    '我為撐過今天的自己感到驕傲。'
  ]),
  ('exam-day', 'zh-hant', 1400, '考試當天', '專注、回想、保持沉穩', array[
    '我已經做好準備，學過的東西都記在腦海裡。',
    '我冷靜地讀每一題，先回答我會的。',
    '如果卡住了，我就深呼吸，輕鬆地繼續往下寫。',
    '我的注意力很集中，思緒很清晰。',
    '一場考試決定不了我的未來，也決定不了我的價值。',
    '我相信自己之前付出的努力。',
    '我專注在當下，一次只寫一題。',
    '我帶著對自己努力的驕傲走出考場。'
  ]),
  ('worthy-as-i-am', 'zh-hant', 1400, '我本來就值得', '在安靜的時刻，感受自己的價值', array[
    '此刻的我，原本的樣子，就值得被愛。',
    '我不需要向任何人證明自己的價值。',
    '我用耐心和溫暖跟自己說話。',
    '我的需要很重要，我會好好重視它們。',
    '我可以大大方方地擁有屬於自己的位置。',
    '我原諒過去那個還不懂的自己。',
    '我正在成為讓自己驕傲的人。',
    '我毫無保留地關心別人，我也值得同樣的關心。'
  ]);

insert into affirmations.collection_texts (collection_id, language, title, subtitle)
select md5('affirmations:collection:' || slug)::uuid, language, title, subtitle
from builtin_l10n
on conflict (collection_id, language) do nothing;

insert into affirmations.affirmations (id, owner_id, text, language, source)
select md5('affirmations:builtin:' || s.slug || ':' || s.language || ':' || t.ord)::uuid,
       null, t.text, s.language, 'builtin'
from builtin_l10n s
cross join lateral unnest(s.texts) with ordinality as t(text, ord)
on conflict (id) do nothing;

insert into affirmations.collection_items (collection_id, position, affirmation_id)
select md5('affirmations:collection:' || s.slug)::uuid, s.base_position + t.ord,
       md5('affirmations:builtin:' || s.slug || ':' || s.language || ':' || t.ord)::uuid
from builtin_l10n s
cross join lateral unnest(s.texts) with ordinality as t(text, ord)
on conflict do nothing;

drop table builtin_l10n;
