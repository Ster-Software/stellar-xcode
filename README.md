# Xcode voor Stellar Studio

Xcode-projecten bouwen, starten, testen en archiveren, uploaden naar App Store Connect en een iOS Simulator bedienen vanuit Stellar Studio.

## Installeren

Open **Extensies** in Stellar Studio, zoek **Xcode** van **Ster-Software** en kies **Installeren**. Dit is de opvolger van de losse iOS Simulator-extensie; verwijder die oude extensie om dubbele simulatorbediening te voorkomen.

Voor handmatige installatie: pak het bronarchief van een release uit in `~/.stellar/extensions/@ster-software/xcode/`, met `manifest.json` direct in die map.

## Gebruik

Open een map met een `.xcodeproj` of `.xcworkspace` en klik op het Xcode-icoon. Kies het project, scheme, de configuratie en bestemming. De zijbalk biedt bouwen, starten, testen, clean, archives en uploaden. Opdrachten draaien in Stellar-terminals; hun uitslag verschijnt ook in de statusbalk.

De sectie **Simulator** opent een simulatorpaneel met een live scherm en bediening. De eerste keer helpt het paneel bij het installeren van de bridge-afhankelijkheden in `~/.stellar/sim-bridge/`. Bestaande bridgebestanden worden hergebruikt.

Agents krijgen de MCP-tools `xcode_projects` en `xcode_run`. In een chat start `/xcode-build` een build en zet de uitslag in het gesprek. De extensie levert ook de automatiseringstrigger **Een Xcode-actie is klaar**.

## Vereisten en toegang

Stellar Studio 1.8.20 of nieuwer, macOS en Xcode met de gewenste SDK's. Het ingebouwde simulatorpaneel vereist een Apple silicon-Mac en geïnstalleerde iOS-simulators. Voor uploaden zijn de juiste signing- en App Store Connect-instellingen nodig.

De extensie gebruikt bestanden, processen en netwerk: Xcode-opdrachten, projectbestanden, de lokale simulatorbridge en downloads voor de bridge. Toegangsrechten zijn informatief; extensies draaien met de rechten van Stellar.

Broncode: https://github.com/Ster-Software/stellar-xcode
