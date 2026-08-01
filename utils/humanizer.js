// ============================================================
// utils/humanizer.js - Hace que MARTIN suene humano
// ============================================================

export function humanizarRespuesta(texto) {
    // Si es un saludo corto (menos de 30 caracteres), no lo modificamos
    if (texto.length < 30) {
        return texto;
    }
    
    // 15% de probabilidad de agregar muletilla (solo si no es un saludo)
    if (Math.random() < 0.15 && !texto.startsWith('Hola') && !texto.startsWith('Buen')) {
        const muletillas = ['Mirá, ', 'Básicamente '];
        const elegida = muletillas[Math.floor(Math.random() * muletillas.length)];
        texto = elegida + texto.toLowerCase();
        texto = texto.charAt(0).toUpperCase() + texto.slice(1);
    }
    
    // 10% de probabilidad de pausa (solo si es una respuesta larga)
    if (Math.random() < 0.1 && texto.includes(' ') && texto.length > 50) {
        const palabras = texto.split(' ');
        const index = Math.floor(Math.random() * (palabras.length - 2)) + 1;
        palabras[index] = palabras[index] + '...';
        texto = palabras.join(' ');
    }
    
    return texto;
}