# Dashboard do Bot de Trade

Este painel foi feito para que qualquer pessoa consiga acompanhar o bot de trade de forma visual, sem precisar entender código.

Ele funciona como uma central de controle e monitoramento do bot.

## O que o dashboard mostra

### 1. Situação geral do bot

Na parte principal da tela, o dashboard mostra:

- se o bot está ativo ou pausado
- se o auto-trading está ligado ou desligado
- o lucro ou prejuízo atual
- se a conexão com o backend está funcionando em tempo real

Isso ajuda a entender rapidamente se o sistema está operando normalmente.

### 2. Posições abertas

O painel mostra as operações que estão abertas no momento.

Para cada posição, é possível ver:

- ativo negociado, como `SOL` ou `ETH`
- direção da operação, como compra (`LONG`) ou venda (`SHORT`)
- tamanho da posição
- preço de entrada
- preço atual
- lucro ou prejuízo
- exposição da operação

Isso permite enxergar onde o dinheiro está alocado e como cada trade está performando.

### 3. Métricas visuais

O dashboard também mostra indicadores resumidos para facilitar a leitura:

- PnL atual
- número de operações
- distribuição de exposição por ativo
- visão geral da performance

Esses dados ajudam a entender o risco e o comportamento do bot sem precisar abrir logs técnicos.

### 4. Alertas operacionais

Quando algo importante acontece, o painel pode destacar alertas.

Exemplos:

- bot pausado
- auto-trading desligado
- posições com risco mais alto
- erros recentes

Isso serve como um aviso visual para chamar atenção do operador.

### 5. Logs e eventos

Existe uma área de histórico com mensagens do sistema.

Ela mostra eventos como:

- conexão em tempo real ativada
- bot pausado ou retomado
- auto-trading ligado ou desligado
- erros recentes
- sinais recebidos, executados ou ignorados

Isso ajuda a entender o que aconteceu nos últimos momentos.

## O que pode ser controlado pelo dashboard

Além de mostrar informações, o painel também permite agir sobre o bot.

### 1. Pausar o bot

Ao pausar, o bot continua online, mas deixa de executar novos sinais.

Isso é útil quando você quer interromper temporariamente as operações sem desligar o sistema inteiro.

### 2. Retomar o bot

Ao retomar, o bot volta a operar normalmente.

### 3. Ligar ou desligar o auto-trading

Quando o auto-trading está:

- ligado: o bot pode executar operações automaticamente
- desligado: o bot continua monitorando, mas não envia novas ordens por conta própria

Isso é útil para colocar o sistema em modo observação.

### 4. Fechar uma posição específica

O painel permite mandar o comando para encerrar uma operação de um ativo específico.

Exemplo:

- fechar apenas a posição de `SOL`

### 5. Fechar todas as posições

Também é possível enviar um comando para encerrar tudo de uma vez.

Essa ação existe para momentos de emergência, redução rápida de risco ou necessidade de parar toda a exposição do bot.

Por segurança, essa ação pede confirmação.

## Atualização em tempo real

O dashboard foi feito para atualizar automaticamente.

Isso significa que:

- o estado do bot aparece quase em tempo real
- mudanças de pausa, retomada e auto-trading aparecem na tela
- novas atualizações de posições e status podem ser refletidas sem precisar recarregar a página

Se a conexão em tempo real cair, o sistema ainda tenta continuar funcionando de forma resiliente.

## O que o dashboard não faz sozinho

O dashboard não é o bot.

Ele é apenas a interface visual.

Quem realmente executa as ações é o backend do `TradeFinderBot`.

Ou seja:

- o dashboard mostra
- o backend decide e executa

## Resumo simples

Em termos práticos, o dashboard serve para:

- ver se o bot está funcionando
- acompanhar posições e resultados
- enxergar risco e exposição
- receber alertas
- pausar ou retomar a operação
- controlar o auto-trading
- fechar posições individuais ou todas de uma vez

Se você pensar no bot como um carro, o dashboard é o painel e o volante.
Ele não é o motor, mas é por ele que você enxerga o que está acontecendo e toma decisões.
