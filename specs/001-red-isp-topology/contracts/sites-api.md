# API Contract: Sites (relevant endpoints)

## GET /api/sites

**Auth**: admin, technician  
**Response**:
```json
{
  "tree": [{ "id", "name", "parentId", "equipment": [...], "children": [...] }],
  "unassigned": [...],
  "stats": { "sites", "routers", "online", "cpe" }
}
```

## PATCH /api/sites/:id

**Auth**: admin  
**Body** (partial):
```json
{
  "name": "string",
  "type": "tower|node|pop|office",
  "parentId": 1 | null,
  "city": "string",
  "address": "string",
  "latitude": "string",
  "longitude": "string"
}
```

**Rules**:
- `parentId` null → nodo raíz
- No ciclos (validación manual en UI excluyendo descendientes)

## POST /api/sites

**Body**: incluye `parentId` opcional (hijo del sitio seleccionado al crear)
