/* Service worker MV3 dla Chrome/Edge: najpierw shim browser→chrome,
   potem wspólny background.js (ten sam plik co w Firefoksie). */
importScripts('browser-shim.js', 'background.js');
