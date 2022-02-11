I usually run migration as part of init container:

```
initContainers:
    - name: init-backend-neptune
        image: CONTAINER_IMAGE
        envFrom:
        - configMapRef:
            name: backend-neptune
        imagePullPolicy: "Always"
        command: ["sh", "-c", "yarn pscale:migrate"]
```

Because of brancing and blocking schema changes (which are good) it's a pain to handle migrations.

Let's take typical workflow:

1. Already applied schema changes are usually tracked in `migrations` table by many frameworks
2. We write a new migration
3. We run `something migrate` command
4. It applies schema changes and also tracks them in `migrations` table

Using planetscale brings two issues:

1. When we take a branch from main, it doesn't bring along any data, so our migrations tables are empty
2. But it does bring all the tables (meaning existing schema)
3. So, if we run `something migrate`, it would try to apple all schema changes, but fails, because tables are already present.
4. pscale has copy migrations features when creating a branch, but I faced few issues after raising deploy request
5. Irrespective of that, after deploying my branch back to main, migrations table seemed outdated

So, i wrote a script in nodejs, to handle this scenarion, I used knexjs for it.

- `pscale` cli should be available
- Create service token and put them in ENV
- Create a branch from main, let's called "migrator"
- Wait for branch to become "ready"
- Create Password for branch
- Get data from migrations table of "main" branch and insert into migrations table of "migrator" branch
- Run `something migrate` (At this point, migrator branch has correct migrations which we are expecting)
- Get data from migrations table of "migrator" branch and insert into migrations table of "main" branch
- Create a deploy request and till it becomes "deployable"
- Create a "deploy" deploy request (Basically `pscale deploy-request deploy`)
- Wait till deployment state becomes "complete"
- Delete branch

---

The code written is quick and dirty, but I guess logic might be the same.
