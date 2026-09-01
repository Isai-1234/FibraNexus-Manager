# ORDEN 010

**task:** Verificar device tracking end-to-end: SNMP → equipment.last_seen actualizado

**status:** ok

## CMD 1 — OK
```
5|fibranex | [scheduler:scheduled] AP station sync dispatched for 3 org(s)
5|fibranex | [scheduler:scheduled] SNMP + router dispatched for 3 org(s)
5|fibranex | [scheduler:scheduled] AP station sync dispatched for 3 org(s)

```

## CMD 2 — OK
```
 id |           name           | status  | last_seen 
----+--------------------------+---------+-----------
 13 | PowerBeam Complejo Lago  | online  | 
  9 | LiteBeam Pedro           | online  | 
  6 | RB4011 Torre Norte       | online  | 
  7 | LiteBeam Sectorial Norte | online  | 
 10 | NanoStation Javiera      | offline | 
(5 rows)


```

## CMD 3 — OK
```
175

```
