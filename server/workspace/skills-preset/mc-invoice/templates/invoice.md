## Task: generate a printable invoice document

The invoice record is in the `<record_data_json>` block above (fields:
`id`, `clientId`, `issueDate`, `dueDate`, `status`, `lineItems[]`
(`description`, `quantity`, `rate`), `taxRate`, `notes`).

Produce a clean, print-ready invoice as a Markdown document (inline HTML
is fine) and present it in the canvas with the `presentDocument` tool.
Follow these steps:

1. **Resolve the recipient (Bill To).** Read
   `data/clients/items/<clientId>.json` (the `clientId` from the record
   above) for the client's `name`, `address`, and `email`.

2. **Resolve the issuer (From).** Read `data/profile/items/me.json` for
   the user's own business identity: `companyName`, `taxRegistrationId`,
   `address`, `email`, `phone`, `paymentDetails`. **If that file does not
   exist**, stop and tell the user their business profile isn't set up
   yet — point them at `/collections/mc-profile` — and do not write a
   half-blank invoice.

3. **Compute the totals** from the line items: `subtotal` =
   Σ(`quantity` × `rate`), `tax` = `subtotal` × `taxRate` (treat a
   missing `taxRate` as 0), `total` = `subtotal` + `tax`. Format money
   with the currency the amounts are denominated in (the sample books
   use Japanese yen, `¥`; use the symbol that matches the user's data).

4. **Render** using this layout (substitute the resolved values; omit a
   block whose source field is empty):

```
<div style="font-family: 'Helvetica Neue','Hiragino Sans',sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #2c3e50;">

<div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #1a365d; padding-bottom:16px; margin-bottom:32px;">
  <div>
    <h1 style="font-size:36px; letter-spacing:8px; margin:0; color:#1a365d; font-weight:300;">INVOICE</h1>
    <p style="margin:4px 0 0; color:#718096; font-size:14px; letter-spacing:4px;">請&nbsp;求&nbsp;書</p>
  </div>
  <div style="text-align:right; font-size:13px; color:#4a5568;">
    <div><strong style="color:#1a365d;">No.</strong> {id}</div>
    <div><strong style="color:#1a365d;">発行日 / Issued:</strong> {issueDate}</div>
    <div><strong style="color:#1a365d;">支払期限 / Due:</strong> {dueDate}</div>
  </div>
</div>

<table style="width:100%; border:none; margin-bottom:32px;"><tr style="border:none;">
<td style="border:none; vertical-align:top; width:55%; padding:0;">
<div style="font-size:11px; color:#718096; letter-spacing:2px; margin-bottom:8px;">BILL TO</div>
<div style="font-size:22px; font-weight:500; color:#1a365d;">{client.name} 御中</div>
<div style="margin-top:8px; color:#4a5568; font-size:13px;">{client.address}</div>
</td>
<td style="border:none; vertical-align:top; width:45%; padding:0 0 0 24px;">
<div style="background:#f7fafc; border-left:3px solid #1a365d; padding:16px 20px; font-size:13px; line-height:1.8;">
<div style="font-size:11px; color:#718096; letter-spacing:2px; margin-bottom:6px;">FROM</div>
<div style="font-weight:600; color:#1a365d; font-size:15px;">{issuer.companyName}</div>
<div style="color:#718096; font-size:12px;">登録番号 / Tax ID: {issuer.taxRegistrationId}</div>
<div style="margin-top:6px;">{issuer.address}</div>
<div style="margin-top:6px; color:#4a5568;">{issuer.email} · {issuer.phone}</div>
</div>
</td>
</tr></table>

<div style="font-size:11px; color:#718096; letter-spacing:2px; margin-bottom:8px;">DETAILS</div>

| 品目 / Description | 数量 / Qty | 単価 / Rate | 金額 / Amount |
|---|---:|---:|---:|
| {each line item: description | quantity | rate | quantity×rate} |

<div style="margin-top:16px; text-align:right; font-size:14px;">
<div>小計 / Subtotal: {subtotal}</div>
<div>消費税 / Tax: {tax}</div>
<div style="font-size:20px; font-weight:600; color:#1a365d; margin-top:8px;">合計 / TOTAL: {total}</div>
</div>

<div style="margin-top:32px; background:#f7fafc; padding:20px 24px; border-radius:4px;">
<div style="font-size:11px; color:#718096; letter-spacing:2px; margin-bottom:8px;">PAYMENT</div>
<div style="font-size:13px; color:#4a5568;">{issuer.paymentDetails}</div>
</div>

</div>
```

5. **Present it with `presentDocument`.** Call the `presentDocument`
   tool with:
   - `title`: `Invoice {id}` (e.g. `Invoice INV-2026-0001`),
   - `markdown`: the full rendered document from step 4,
   - `filenamePrefix`: the invoice `id`.

   This renders the invoice in the canvas where the user can review and
   download it as a PDF. **Do this** — do not just paste the markdown
   into the chat or write a raw file; `presentDocument` is the only
   correct way to surface the document.

6. **Confirm** in one short sentence that the invoice is ready in the
   canvas. Do not add tips about how to export or print it — the canvas
   already provides a PDF download.
