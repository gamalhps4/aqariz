# PropertyPro — User Manual

For the staff of a real-estate office managing properties on behalf of owners.

النسخة العربية: [user-manual.ar.md](user-manual.ar.md)

---

## 1. What this system is for

The office manages property for **several different owners**. Everything in
PropertyPro hangs off that one relationship:

```
Owner → Property → Building/Unit → Tenant → Contract → Installment → Payment → Report
```

Each step points at the one before it. That is why a contract cannot be created
without a unit, and why a payment always belongs to an installment: it is what
makes the owner's report add up at the end of the month.

---

## 2. The daily workflow

Work in this order. Each step assumes the one above it exists.

| # | Step | Where |
| --- | --- | --- |
| 1 | Add the owner | Clients → Owners → **Add owner** |
| 2 | Add the compound, then the property and its units | Compounds → Properties |
| 3 | Add the tenant | Tenants → Add tenant |
| 4 | Create the contract on the owner's behalf | Contracts → Create |
| 5 | Collect payments as they fall due | Payments, or the contract's installment list |
| 6 | Watch what is due and overdue | Payments → Reports |
| 7 | Terminate the contract when required | Contract → Terminate |
| 8 | Send the owner their report | Reports → export to PDF or Excel |

---

## 3. Owners

**Clients → Owners.**

The list shows everyone who owns property — including a landlord who manages
their own buildings, who appears automatically without anyone creating a record.

**To add an owner the office has just signed:** click **Add owner** and enter
their name, entity type, ID or CR number, phone and email. You are taken to
their page, where bank and tax details for payouts are filled in.

An owner starts with no buildings. That is correct: the person is entered first,
their portfolio after.

### The owner's page

- **Statement** — collections, expenses, commission and the balance owed to
  them, tied to real contracts and payments rather than typed in.
- **Properties** — their buildings and the occupancy of each.
- **Profile** — payout method, bank details, tax number, notes.

---

## 4. Compounds, properties and units

- **Compound** — a residential complex. Optional; a standalone building needs
  no compound.
- **Property** — a building. Belongs to one owner, optionally inside a compound.
- **Unit** — a rentable space. One building may hold several different unit
  types (apartment, shop, office) at once.

Property and unit types are editable in **Settings → Categories**. Add the ones
this office actually uses; they appear immediately in every dropdown.

---

## 5. Tenants

**Tenants → Add tenant.** Five fields:

| Field | Notes |
| --- | --- |
| Full name | One field, written as it appears on the contract. |
| Entity type | Individual or Company. |
| ID / CR number | National ID for a person, Commercial Registration for a company. |
| Phone | Used for SMS and WhatsApp reminders. |
| Email | Used for the invitation and for invoices. |

You can either set a password immediately or send an invitation email and let
the tenant choose their own.

---

## 6. Contracts

**Contracts → Create.** A contract links the property, unit, owner and tenant,
and it is what everything financial is generated from.

| Field | What it does |
| --- | --- |
| Contract number | The office's own reference, printed on the contract. **The contract list is searchable by it**, as well as by tenant name, phone and property. |
| Start / end date | The duration is calculated from these. 01/01/2026 → 01/01/2027 is one year; 01/01/2026 → 01/02/2026 is one month. |
| Payment frequency | Monthly, quarterly, semi-annual or annual. Decides how many installments there are. |
| Rent per installment | The amount due **each time**, not a monthly figure that gets multiplied. A quarterly contract of 30,000 means 30,000 every quarter. |
| Electricity / water | Optional, charged with each installment alongside the rent, and prorated with it on a short final period. Leave at 0 when the tenant pays the utility directly. |
| Tax | Per contract, not per office — one office holds both VAT-bearing and exempt contracts. Applies to rent and utilities together. |
| Security deposit | Held separately from rent. |

### The installment schedule

The contract page lists every installment with its due date, amount, what has
been paid, what remains, and its status:

- **Paid** — settled in full.
- **Partly paid** — some money received.
- **Due** — payable now.
- **Overdue** — past its due date and unpaid.
- **Scheduled** — a future installment.
- **Not billed yet** — the contract calls for it but no invoice exists yet.

Installments can be added, edited or removed from this screen. What you see here
is exactly what gets billed — the preview and the generator are the same
calculation.

### Terminating a contract

**Termination and deletion are different things.**

- **Terminate** ends a live contract. The record, its installments and its
  payments all stay, because the money history has to remain explainable.
- **Delete** moves the contract to the Archive, from where it can be restored.

---

## 7. Payments

A payment can be recorded from **two** places, whichever suits the moment:

- **Payments → Record** — start from the money.
- **The contract's installment list** — start from what is owed.

Either way, record the amount, the date, the method and any note.

### Payment methods

Alongside bank transfer, card, cash, cheque and money order:

- **Ejari platform** — settled on the tenancy platform. The money never passes
  through the office account.
- **Paid to owner's account** — the tenant paid the owner directly.

Both close the installment exactly like any other payment — the rent genuinely
was paid, and the owner's statement must say so. What differs is that the office
holds nothing to remit afterwards.

**Payment notes are carried through to the reports**, so an explanation written
once at collection time is still there when the owner asks about it.

---

## 8. Reports

**Each report has its own columns and its own filters** — they are not one
template with the data swapped.

| Report | Answers |
| --- | --- |
| Overdue | Who is late, by how much, for how many days. |
| Outstanding | Everything still owed, whether or not it is late yet. |
| Payments received | What was collected in a period. |
| Payments by building | Collection broken down per property. |
| Expenses by building | What each property cost. |
| Contracts | Active, expiring and terminated contracts. |
| Agreements | Management agreements and commission. |
| Owner statement | One owner's collections, expenses, commission and balance. |

### Exporting

Every report exports to **Excel**, **PDF** and **CSV** from the same button.
The export re-runs the same query as the screen, so the file and the screen can
never disagree.

- **Excel** — numbers stay numbers, so the recipient can sum a column.
- **PDF** — what you send to an owner. It prints the same everywhere and cannot
  be edited on the way. Exporting while the interface is in Arabic produces a
  right-to-left table.
- **CSV** — for feeding another system.

Filters are applied to the export, not just the screen: filter first, then
export.

---

## 9. Archive and deletion

**Archive** is a top-level item in the main menu.

Deleting anything — an owner, property, unit, contract, agreement, invoice,
payment or maintenance request — moves it to the Archive rather than destroying
it. Nothing disappears silently.

In the Archive you can:

- **Search** within a category.
- **Restore** a record, putting it back where it was.
- **Permanently delete** it. Shown in red, and restricted: only the account
  owner or a platform super-admin, and only if they also hold the
  *permanent delete* permission.

Permanent deletion is refused while anything still points at the record — for
example a contract with invoices against it. The message names what is blocking
it. This is deliberate: destroying that contract would leave paid invoices
attached to nothing.

---

## 10. Notifications

Automatic, once configured by whoever runs the server:

| Trigger | Sent to |
| --- | --- |
| Rent due soon | Tenant |
| Payment overdue | Tenant |
| Contract expiring | Tenant and office |

Channels are **email**, **SMS**, **WhatsApp**, plus push and in-app. SMS and
WhatsApp are used for urgent notices only, since each message costs money.

If SMS or WhatsApp is not configured for your deployment, the notice still goes
out by email — nothing is silently lost.

---

## 11. Staff and permissions

**Administration → Users.**

Each employee has a **role**, and the role decides what they can do. Roles are
edited in **Administration → Users → Roles**, with a checkbox per permission
grouped by module.

Permissions separate actions that carry different trust: viewing, creating,
editing, deleting (recoverable), permanently deleting (not recoverable), and
exporting.

Where one person is an exception, their permissions can be adjusted
individually without inventing a new role — extra permissions added, or some
taken away. A permission taken away always wins over one granted.

Features an employee cannot use are hidden from their navigation, not merely
blocked when clicked.

---

## 12. Language

**Settings → Appearance** switches the interface between Arabic, English,
German, Spanish and French. Arabic switches the whole layout to right-to-left.

The language also follows into exported PDFs, so a report exported by an
Arabic-speaking member of staff is laid out for an Arabic reader.

---

## 13. Common questions

**An owner is not in the list.**
Either no property points at them yet and no record was created — use
**Add owner** — or their record was archived. Check **Archive → Owners**.

**A contract cannot be found by its number.**
Search on the contracts list accepts the contract number, tenant name, phone and
property. Check the number was actually saved on the contract.

**A payment was recorded but the installment still shows as due.**
The payment was probably not linked to that installment. Record payments from
the installment row, or open the payment and attach it to the right invoice.

**A report total looks wrong.**
Check the period filter first — reports default to the current month to date.
Every figure traces back to real contracts, installments and payments; open the
matching detail report to see the rows behind the total.

**Deleted something by mistake.**
It is in the Archive. Restore it.

**Permanent deletion is refused.**
Something still references the record. The message says what. Remove or
reassign those first — the refusal is protecting the financial history.
