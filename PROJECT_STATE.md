# Bot Trader — Project State

## 📌 Overview
Bot de trading perp multi-venue em Node.js com execução automática e manual, focado em baixo risco e evolução incremental.

---

## 🧠 Arquitetura Atual

### Core
- VenueRegistry (manifests + capabilities)
- PerpExecutionService (roteamento por venue)
- risk_manager desacoplado do Drift
- ManualTradeService reutiliza fluxo automático via executeSignal

### Monitoring
- venueMonitoringService (por venue)
- data_fetcher desacoplado do Drift
- driftMonitoring implementado
- outras venues com stub

### Positions
- state.positions inclui `venue`
- PositionManager preserva `venue`
- trailing stop usa `position.venue` para fechar

### Execution
- closeTrade aceita `venueOverride`
- trailing já usa venue explícita
- fluxo manual e automático unificados
- política de close documentada em `docs/pt-BR/politica-de-close.md`

---

## 🧩 Venue System

### Registry
- registerVenue(manifest)
- getExecutionAdapter()
- getMonitoringAdapter()
- getActiveVenue()
- supports(venue, capability)

### Manifests
Cada venue define:
- executionAdapter
- monitoringAdapter
- capabilities

### Capabilities atuais
- supportsOpenTrade
- supportsCloseTrade
- supportsCloseAll
- supportsMonitoring
- supportsUpdateTpSl
- supportsAccountSnapshot
- supportsMarketLimits
- supportsBalance
- supportsSupportedAssets
- supportsPlatformMaxLeverage

---

## 📊 Status das Venues

### Drift
- execução completa
- monitoring completo
- risk integrado
- referência principal

### Jupiter / Phoenix
- adapters criados
- monitoring stub
- capabilities parciais
- não prontas para uso real

---

## ⚠️ Limitações Atuais

- tracking por `asset` (não `asset + venue`)
- multi-venue simultânea ainda não suportada
- flows remotos e system/admin recusam close quando a venue não pode ser resolvida com segurança
- paper mode assume Drift (venue fixa)
- monitoring não suporta múltiplas venues simultâneas
- capabilities ainda granulares de forma básica
- `close_all` ainda reflete a suposição prática de uma única venue por vez

---

## ✅ Últimas Evoluções

- unificação manual + automático via executeSignal
- desacoplamento completo de balance/snapshot do Drift
- risk_manager desacoplado de market config Drift
- monitoring abstraído por venue
- criação de VenueRegistry
- manifests por venue
- capabilities por venue
- posições agora carregam venue
- trailing stop fecha usando venue da posição
- closeTrade aceita venueOverride
- política explícita de close consolidada em documentação canônica

---

## 🎯 Objetivo Atual

Expandir suporte multi-venue com mudanças incrementais, mantendo safety-first e regras operacionais explícitas.

Referência operacional:

- política canônica de close: `docs/pt-BR/politica-de-close.md`

---

## 🚀 Direção Futura

Preparar base para:
- suporte real a múltiplas venues
- entrada de novas DEXs (ex: Hyperliquid)
- execução consistente independente da venue

Sem reescrever arquitetura e mantendo estabilidade.

---

## 🧠 Princípios do Projeto

- evolução incremental
- baixo risco de regressão
- sem overengineering
- core agnóstico de venue
- adapters isolam complexidade
