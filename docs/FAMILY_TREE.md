# Connected people in the family tree

From **Family → family & friends → add to tree**, choose an accepted connection and how that
person relates to the selected anchor. The tree's **add someone** button offers the same
chooser; email invitations remain available for people who have not joined. Placement reuses
the existing person and membership. It never automatically adds someone to another family.

Choices include parent/dad/mom, child/son/daughter, grandparent/grandpa/grandma,
grandchild/grandson/granddaughter, spouse/partner, sibling/brother/sister, and friend.

- The chosen role appears above the node. Existing generic roles can be refined, such as
  child → son, while retaining the other person's chosen label.
- Parents appear one generation above children; grandparents appear two above. Missing
  generations stay as spacing rather than invented people. Indirect ancestry labels are
  inferred from the stored graph, not names or ages.
- Family links are solid. Friends sit farther to the right with dotted links and stay out of
  the calculations for the viewer's family generations. Their own connected relatives stay
  with that side of the tree.
- Both connection placement and invitation acceptance reject duplicate/reversed conflicting
  links, third parents, ancestor cycles, and incompatible generation offsets. A family-row
  lock serializes graph checks and writes. Repeating a placement keeps one edge.

`GET/POST /api/families/{family_id}/tree/connections` validates family membership, accepted
connection and both people's family. The candidate list exposes only the caller's accepted
connections; people who are not members of this family need an invitation first.

Migration `20261025134044_family_tree_connections.sql` extends the canonical relationship
and invitation kinds and adds nullable `a_role`/`b_role` labels. It was generated with the
Supabase CLI, tested in an isolated fresh installation and hosted-baseline upgrade, then
applied transactionally to project `kzgssclziixnlqejplqo` under the existing migration
authorization. Existing people, memberships, relationships and invitations were preserved;
RLS and grants were unchanged. SHA-256:
`2047f59c783f9ce7ccfbd3eb988b127ad8668df1b5952115c35de52285f0f044`.

Verification: full backend suite; 64 desktop/mobile browser checks, including six new tree
checks; a focused rerun verifies saved role defaults after placement; lint, TypeScript,
production build, schema-upgrade checks and hosted tree/chooser readback. Browser checks use
synthetic accounts and media. No live family's relationships were created or relabeled.

The migration harness also now recognizes the exact enum extensions in the previously
merged Immersive reference-photo migration, while retaining its prior-value, row-preservation,
RLS and grant checks. Concurrent request-detail edits from another session were preserved.
