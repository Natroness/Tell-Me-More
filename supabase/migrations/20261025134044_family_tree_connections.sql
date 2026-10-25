-- Place accepted connections in the tree without granting new family membership.
-- Canonical edges retain their direction; optional roles preserve labels such as dad/son.
alter table relationship drop constraint relationship_kind_check;
alter table relationship add constraint relationship_kind_check
  check (kind in ('parent', 'grandparent', 'spouse', 'sibling', 'friend'));
alter table relationship
  add column a_role text check (a_role is null or char_length(a_role) between 1 and 32),
  add column b_role text check (b_role is null or char_length(b_role) between 1 and 32);

alter table family_invite drop constraint family_invite_kind_check;
alter table family_invite add constraint family_invite_kind_check check (kind in (
  'parent', 'father', 'mother', 'child', 'son', 'daughter',
  'grandparent', 'grandfather', 'grandmother', 'grandchild', 'grandson', 'granddaughter',
  'spouse', 'sibling', 'brother', 'sister', 'friend'
));
