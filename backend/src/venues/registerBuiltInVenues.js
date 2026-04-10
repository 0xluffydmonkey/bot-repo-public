// src/venues/registerBuiltInVenues.js
// Registers the built-in venue manifests once at module load.

import { venueRegistry } from './VenueRegistry.js';
import { driftVenueManifest } from './manifests/driftVenue.js';
import { jupiterVenueManifest } from './manifests/jupiterVenue.js';
import { phoenixVenueManifest } from './manifests/phoenixVenue.js';
import { valiantVenueManifest } from './manifests/valiantVenue.js';

venueRegistry.registerVenue(driftVenueManifest);
venueRegistry.registerVenue(jupiterVenueManifest);
venueRegistry.registerVenue(phoenixVenueManifest);
venueRegistry.registerVenue(valiantVenueManifest);

export { venueRegistry };
