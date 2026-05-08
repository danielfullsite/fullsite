# Template: Contenido AMALAY (Redes Sociales)

Genera contenido para redes sociales de AMALAY — brunch & café en San Pedro Garza García, Monterrey. Negocio women-owned, jardín tropical, menú de autor.

## Variables

| Variable | Descripción | Opciones |
|---|---|---|
| `{{TIPO}}` | Formato del contenido | `post` (imagen + caption), `story` (15s vertical), `reel` (30-60s vertical) |
| `{{TEMA}}` | Tema o gancho del contenido | `brunch weekend`, `nuevo platillo`, `staff spotlight`, `behind the scenes`, `promo` |
| `{{DRINK}}` | Bebida destacada (opcional) | `Mimosas $100`, `Sexy Mezcalina Jamaica $240`, `My Crush Margarita $240`, `Sexy Aperol Spritz $240` |

## Prompt

```
Genera un {{TIPO}} para Instagram/TikTok de AMALAY.

Tema: {{TEMA}}
Bebida destacada: {{DRINK}}

Reglas:
- Español mexicano, tono cálido y aspiracional pero no pretencioso
- Hashtags: #BrunchMonterrey #AMALAYCafe #SanPedroGarzaGarcia + 3-5 relevantes al tema
- Si es reel/story: incluir hook de 3 segundos + script con timestamps
- Si es post: caption de máximo 150 palabras + sugerencia de foto/composición
- Mencionar ubicación: San Pedro Garza García
- Si hay drink: incluir precio y descripción sensorial
- CTA natural (nunca "link in bio" genérico)
```

## Ejemplos de uso

**Post de Mimosas:**
```
/social-content Genera un post para AMALAY. Tema: brunch weekend. Drink: Mimosas $100.
```

**Reel de staff:**
```
/social-content Genera un reel para AMALAY. Tema: staff spotlight con Omar. 30 segundos.
```
