// ============================================================
// utils/humanizer.js - Hace que MARTIN suene humano
// ============================================================

export function humanizarRespuesta(texto) {
    if (Math.random() < 0.2) {
        const muletillas = ['Mirá, ', 'Escuchá, ', 'Básicamente ', 'La cuestión es que ', 'Y... '];
        const elegida = muletillas[Math.floor(Math.random() * muletillas.length)];
        texto = elegida + texto.toLowerCase();
        texto = texto.charAt(0).toUpperCase() + texto.slice(1);
    }
    
    if (Math.random() < 0.1 && texto.includes(' ')) {
        const palabras = texto.split(' ');
        const index = Math.floor(Math.random() * (palabras.length - 2)) + 1;
        palabras[index] = palabras[index] + '...';
        texto = palabras.join(' ');
    }
    
    return texto;
}