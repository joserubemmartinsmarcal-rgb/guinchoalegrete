s = open('../posts-novembro/posts.html').read()
head = s[:s.index('<body>')]
car = '''<body>
<section class="s esc"><div class="foto"></div><div class="vel"></div><div class="z"><img class="logo" src="../../public/assets/gf-mark.png" alt="">
<div style="margin-top:120px"><div class="eye">Para guincheiros do RS</div>
<h1>Por que entrar <em>no GF?</em></h1><p class="l">5 motivos para nunca mais voltar vazio.</p></div>
<div class="pe" style="margin-top:60px"><b>appdoguincheiro.com</b><span class="seta">Arraste →</span></div></div></section>
<section class="s cla"><span class="selo"><img src="../../public/assets/gf-mark.png" alt=""></span><div class="eye">1 · Volta paga</div>
<h2>Anuncie a volta. <em>Pegue frete no caminho.</em></h2><p class="l">O GF mostra os pedidos que cabem na sua rota, com o valor e quantos km desvia.</p>
<div class="pe"><span class="n">2/6</span><span class="seta">→</span></div></section>
<section class="s esc"><div class="glow"></div><div class="z"><img class="logo" src="../../public/assets/gf-mark.png" alt=""><div class="eye">2 · Chamado urgente</div>
<h2>Tocou o alarme? <em>O primeiro que aceita leva.</em></h2><p class="l">O cliente diz o valor; você aceita em um toque ou negocia.</p>
<div class="pe"><span class="n">3/6</span><span class="seta">→</span></div></div></section>
<section class="s cla"><span class="selo"><img src="../../public/assets/gf-mark.png" alt=""></span><div class="eye">3 · Dinheiro na hora</div>
<h2>Fez o serviço? <em>Receba em até 3h.</em></h2><p class="l">Antecipação de seguradora, empresa, cartão ou Pix a prazo com a JK Invest, após a aprovação.</p>
<div class="pe"><span class="n">4/6</span><span class="seta">→</span></div></section>
<section class="s esc"><div class="glow"></div><div class="z"><img class="logo" src="../../public/assets/gf-mark.png" alt=""><div class="eye">4 e 5 · Proteção e parceria</div>
<h2>Vistoria com fotos. <em>Colega ajuda colega.</em></h2>
<div class="checks"><div><b>Vistoria com assinatura</b> do cliente: chega de reclamação de dano antigo.</div><div><b>Repasse, vaga e caminhão cedido</b> entre guincheiros da rede.</div></div>
<div class="pe"><span class="n">5/6</span><span class="seta">→</span></div></div></section>
<section class="s esc"><div class="glow"></div><div class="z"><img class="logo" src="../../public/assets/gf-mark.png" alt=""><div class="eye">Grátis nesta fase</div>
<h2>O seu caminhão nunca mais <em>volta vazio.</em></h2><div class="cta"><a class="p">appdoguincheiro.com</a><a class="s2">Link na bio · @guinchofacil.app</a></div>
<div class="pe"><span class="n">6/6</span><span></span></div></div></section></body></html>'''
open('04-carrossel.html', 'w').write(head + car)
css = '<style>.a4{width:1240px;height:1754px;padding:110px 100px;background:#fff;color:#0F172A;font-family:"Inter Tight";display:flex;flex-direction:column}.a4 h1{font-size:96px;line-height:1;letter-spacing:-.04em}.a4 em{font-style:normal;color:#1E40AF}.a4 .lst{margin:60px 0;display:grid;gap:30px}.a4 .lst div{font-size:40px;padding-left:64px;position:relative}.a4 .lst div:before{content:"✓";position:absolute;left:0;width:46px;height:46px;border-radius:50%;background:#3B82F6;color:#fff;display:grid;place-items:center;font-weight:800;font-size:28px}.a4 .qr{margin-top:auto;display:flex;gap:50px;align-items:center;background:#F8FAFC;border-radius:30px;padding:40px}.a4 .qr img{width:300px}.a4 .qr b{font-size:46px;display:block}.a4 .qr span{font-size:30px;color:#475569}</style></head>'
fol = head.replace('</head>', css) + '''<body><div class="a4"><img src="../../public/assets/gf-mark.png" style="height:80px;align-self:flex-start;background:#0F172A;padding:16px 22px;border-radius:18px">
<h1 style="margin-top:70px">Precisa mandar <em>um veículo?</em></h1>
<p style="font-size:40px;color:#334155;margin-top:30px;line-height:1.35">Guincho para oficinas, revendas, locadoras e particulares no RS.</p>
<div class="lst"><div><b>Você diz quanto paga</b>: guincheiros aceitam ou negociam</div><div><b>Guincheiros conferidos</b> pela equipe GF</div><div><b>Vistoria com fotos e assinatura</b> na retirada</div><div><b>Acompanhe</b> cada etapa e onde está o guincho</div><div><b>Chamado urgente</b>: o primeiro disponível vai</div></div>
<div class="qr"><img src="qr-app.png"><div><b>Aponte a câmera e peça agora</b><span>appdoguincheiro.com · grátis nesta fase</span></div></div></div></body></html>'''
open('05-folheto-oficinas.html', 'w').write(fol)
