# Lacunas e Riscos Conhecidos

## Propósito

Registrar lacunas encontradas durante o mapeamento da documentação e classificar riscos sem inventar arquitetura nova.

## Público-alvo

Mantenedores, operadores e revisores de segurança.

## Escala

- Crítico: pode causar perda direta de fundos, vazamento de chave/sessão ou execução indevida.
- Alto: pode causar operação live incorreta, controle remoto indevido ou perda relevante de auditoria.
- Médio: causa degradação operacional, diagnóstico ruim ou comportamento confuso.
- Baixo: impacto limitado, normalmente documentação ou manutenção.

## Lacunas Classificadas

| Severidade | Lacuna | Status | Mitigação atual |
|-----------|--------|--------|-----------------|
| Crítico | Qualquer chave privada, seed, sessão Telegram ou DB URL bruta em `.env` | Controle implementado para variáveis conhecidas | `validateEnv`, docs de `*_PATH`, `scan-secrets.sh` parcial |
| Crítico | Histórico de wallet drain indica ameaça real ao ambiente | Contexto operacional | manter segredos fora do repo, permissão `600`, revisar scripts, paper-first |
| Alto | Painel remoto sem `WEB_API_TOKEN` | Controle implementado para ações críticas | localhost-only sem token; token obrigatório para remoto |
| Alto | Control bot com autorização ampla | Configurável | usar `TELEGRAM_CONTROL_ALLOWED_IDS` explícito |
| Alto | Auto-trading ao vivo em venue recém-configurada | Parcial | Valiant tem gate `ENABLE_AUTO_TRADING_VALIANT`; novas venues devem copiar o padrão |
| Alto | Jupiter/Phoenix registrados mas não live-ready | Documentado no manifest | fail-fast por capacidades; docs marcam como parcial |
| Médio | Supabase sem migrations versionadas no repo | Lacuna real | esquema completo documentado em `integracoes/supabase.md` |
| Médio | Supabase é best-effort e não bloqueia trading | Decisão implementada | logs e painel indicam degradação; não usar como fonte de verdade de execução |
| Médio | Paper engine em memória perde estado no restart | Comportamento implementado | documentado em paper/persistência |
| Médio | Multi-venue simultâneo para mesmo ativo ainda limitado | Parcial | close remoto estrito; docs alertam uma venue por vez na prática |
| Médio | `scripts/scan-secrets.sh` não cobre todos os segredos brutos bloqueados | Lacuna de ferramenta | usar `validateEnv` no boot e revisão humana; ampliar script em mudança futura |
| Médio | Enriquecimento de reconciliação (Pass 2) só suporta valiant | Limitação conhecida | documentado; drift/jupiter/phoenix deixarão `exit_price = null` para closes externos |
| Médio | Reconciliação/adoção considera apenas a venue ativa por ciclo | Limitação conhecida | documentado em reconciliação/operação ao vivo; operar uma venue live por vez na prática |
| Baixo | Estrutura de docs antiga ainda presente | Compatibilidade | nova estrutura substitui; arquivos antigos a remover |

## Observações Importantes

Supabase está implementado como PostgreSQL direto via `pg`, não via SDK Supabase. Portanto, guias que pedem `SUPABASE_URL` ou anon key seriam incorretos para o estado atual.

Jupiter e Phoenix existem no código como manifests/adapters, mas os manifests declaram `liveReady=false`; não devem ser tratados como prontos para live.

Valiant está live-ready, mas com gate adicional para auto-trading automático. Manual live ainda exige cuidado operacional e teste pequeno.

O serviço de reconciliação é bidirecional. Ele atualiza trades `OPEN` travados no banco para `CLOSED`, enriquece `exit_price` quando há suporte e pode criar um trade `OPEN` ao adotar uma posição live da venue ativa. A adoção é limitada a posições confirmadas, não ambíguas e da venue ativa, usando `open_source='venue_reconciliation'`.

## Ações Incrementais Recomendadas

1. Ampliar `scripts/scan-secrets.sh` para incluir `VALIANT_MAIN_KEY` e `SUPABASE_DB_URL`.
2. Adicionar migrations SQL versionadas para o esquema Supabase.
3. Criar lista de verificação automatizado que valide tabelas Supabase.
4. Revisar política de leitura aberta do painel se ele for exposto fora de rede privada.
5. Documentar procedimento de rotação de chaves por venue.

## Lista de Verificação Final

- [ ] Riscos críticos conhecidos estão documentados
- [ ] Lacunas não foram mascaradas como features prontas
- [ ] Mitigações atuais apontam para controles reais do repo
- [ ] Próximas ações são incrementais e de baixo risco
