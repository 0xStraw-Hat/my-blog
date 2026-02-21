+++
date = '2026-02-21T14:23:38+02:00'
draft = false
title = 'Inside glibc vfprintf'
cover = "posts-cover/cat25.gif"
description = "This writeup focuses on glibc's positional-parameter ($) handling in vfprintf."
categories = ["Notes"]
tags = ["C", "Format String"]
+++

## Description

>This writeup focuses on glibc's **positional-parameter ($)** handling in vfprintf: how detecting $ forces an immediate switch from the fast parser to printf_positional. It explains the two-phase positional engine—first parsing all specifiers, then freezing argument values by replaying a saved va_list into args_value[]—and how every later conversion (e.g. %c) is served from that array.

## Introduction

Format string vulnerabilities are among the most subtle and powerful primitives in memory corruption. At first glance, they look simple: control the format string, leak some pointers with %p, maybe write something with %n, and move on.

But once you start digging deeper especially into glibc's internals, you realize that not all format strings behave the same.

Let's quickly recap the basics.

A Quick Refresher

When dealing with a format string vulnerability, two specifiers dominate exploitation:

- %p — used to leak stack values (usually pointers).
- %n — used to write the number of printed bytes to an address.
for example:

```c
printf("%p %p %p");
```

This prints consecutive values pulled from the stack.

If we want to access a specific stack index directly, we can use the positional parameter syntax with `$`:

```c
printf("%25$p");
```

This tells printf:

**"Don't consume arguments sequentially, give me the 25th argument**."

Similarly, we can write to a specific stack argument:

```c
printf("%7$n");
```

Which writes to the 7th argument.

>So far, everything seems straightforward. The $ modifier just looks like a convenient way to index arguments directly instead of walking through them one by one.

Most tutorials stop here.

*But this is where things start getting interesting*.

### The Assumption Most People Make

When exploiting format strings, we often rely on a simple mental model:

printf reads arguments from the stack.

`%n` modifies memory.

Any later reads should reflect that modification.

So naturally, we assume something like this should work:

```c
printf("%n %p");
```

If `%n` modifies some stack value, and `%p` later reads it, we expect %p to print the modified value, Right?

Now let's make it more controlled:

```c
printf("%2$n %2$p");
```

We write to the second argument then immediately print it again.
Logically we expect to see the updated value.

But sometimes…

You don't.

Sometimes it prints the original value.

And that's where the mystery begins.

---

## The Hidden Switch inside glibc

now lets zoom into the internals.

At this point we've seen something very very strange:

- using `$` sometimes causes `printf` to behave in a different way than usuall , especially when mixing `%n` and later reads of teh same argument, in fact this is not accidental it is the result of the internal design inside glibc

### The Entry point

If we examined the source code of printf.c function we will see this:

```c
int printf(const char *format, ...)
{
    va_list arg;
    int done;

    va_start(arg, format);
    done = vprintf(format, arg);
    va_end(arg);

    return done;
}
```

you will notice that the printf uses the internal function vfprintf to parse and print the format.
in fact all the `printf`-style functions do that not just printf.

This `vfprintf` function is responsible for:

- parsing the format string.
- Reading the arguments passed to printf
- pereforming conversions
- writing the final output

So we will need to dive into the `vfprintf` itself to really understand what's going on under the hood.

After analyzing the `vfprintf.c` file I found out this ->

There are two different paths in the file or lets call them **engines**:

- Fast Path & Positionala Path.

once `$` is involved, glibc switches engines and stay there for the rest of the printf call (it does not "go back" to the first engine)

---

## Mind Map

Here's a draw which shows the logic.

![vprintf diagram](/posts-imgs/vprintf/image.png)

I just want you to remember:
>once `$` is involved, glibc switches engines and stay there for the rest of the printf call (it does not "go back" to the Fast Path)

## Fast Path Vs do_Posistional Path

Now lets dive into both of them and study what's different about them.

### Fast Path

the “normal” non-positional engine that runs when the loop didn't encounter `$` yet in the string.

the Function that's responsible for this path is the Xprintf_buffer

```c
Xprintf_buffer (struct Xprintf_buffer *buf, const CHAR_T *format, va_list ap, unsigned int mode_flags)
```

- `Xprintf_buffer` saves a copy of the argument cursor every itiration so it is renewable haha (in case of the fmtstring vuln this is the stack idexes)

- It scans the format string until the next `%` `(__find_specmb/__find_specwc)`, writes the literal text before it, then starts parsing right after `%`.

It parses one specifier at a time:

- reads the next character after `%`
- if it’s width/precision `(123, *, .)` it sets width/prec
- if it’s a length modifier ```(h, hh, l, ll, z, t, j, L, w...)``` it sets type flags and continues
- when it finally hits the conversion letter `(d, x, s, p, c, n, %, etc.)`, it immediately consumes the matching argument from `va_list` with` va_arg(ap, ...)` and prints it.

imagine `va_list` like an array that holds a copy of the printf arguments (in case of the format string vulnerabilty imagine it like the stack idexes)

- in every int

- After finishing that one specifier it advances and finds the next `%`, and do the same checks again.

Now once the Loop encounters a `$` (positional parameters) it will switch to the do_positional engine or path.

```c
if (pos && *tmp == L_('$')){
    goto do_positional;
}
```

### do_positional path

Now its time for the do_positional era haha:

```c
do_positional:
  printf_positional (buf, format, readonly_format, ap, &ap_save,nspecs_done, lead_str_end, work_buffer,
save_errno, grouping, thousands_sep, mode_flags);

```

```md
OKay first lets talk about `specs[]` array.

Its just an array of parsed format specifier descriptions.

In printf_positional, glibc can’t format immediately (because `%2$d` means “use arg #2”), so it first
 builds a list:

Each `specs[i]` corresponds to one`%...` in the format string, and it stores things like:
- `specs[i].info.spec` -> the conversion letter (d, c, s, n, p, ...)
- `specs[i].info.width/prec` -> width/precision 
- `specs[i].next_fmt` -> pointer to where the next `%` starts in the format string
- `specs[i].end_of_fmt` -> pointer to where this specifier ends so it can printf the literal text after it

those are not all of them but the most important things that specs array stores

So “parsing specs” means: calling` __parse_one_specmb/__parse_one_specwc`,
to fill `specs[i]` for each `%...` so later code can say “okay, spec 0 is `%2$c`, spec 1 is `%1$d`.
```

Now moving back to the execution flow of the do_positional engine.

**I will devide it into 4 phases**.

#### Phase one

- In this phase it will iterate over the rest of the string and stores it in the specs array like mentioned above.

```c
  for (const UCHAR_T *f = lead_str_end; *f != L_('\0');
       f = specs[nspecs++].next_fmt)
    {
      if (nspecs == specs_limit)
	{
	  if (!scratch_buffer_grow_preserve (&specsbuf))
	    {
	      Xprintf_buffer_mark_failed (buf);
	      goto all_done;
	    }
	  specs = specsbuf.data;
	  specs_limit = specsbuf.length / sizeof (specs[0]);
	}

      /* Parse the format specifier.  */
      bool failed;
#ifdef COMPILE_WPRINTF
      nargs += __parse_one_specwc (f, nargs, &specs[nspecs], &max_ref_arg,
				   &failed);
#else
      nargs += __parse_one_specmb (f, nargs, &specs[nspecs], &max_ref_arg,
				   &failed);
#endif
      if (failed)
	{
	  Xprintf_buffer_mark_failed (buf);
	  goto all_done;
	}
    }

  /* Determine the number of arguments the format string consumes.  */
  nargs = MAX (nargs, max_ref_arg);

  union printf_arg *args_value;
```

calls ` __parse_one_specmb/__parse_one_specwc` repeatedly.
output: each `specs[i]` records flags,width,prec,length,spec + which arg indexes it references.

---

#### phase two

**Compute argument types**.


```c
  for (cnt = 0; cnt < nspecs; ++cnt)
    {
        /* If the width is determined by an argument this is an int.  */
      if (specs[cnt].width_arg != -1)
	args_type[specs[cnt].width_arg] = PA_INT;

/* If the precision is determined by an argument this is an int.  */
      if (specs[cnt].prec_arg != -1)
	args_type[specs[cnt].prec_arg] = PA_INT;

switch (specs[cnt].ndata_args)
	{
        case 0:		/* No arguments.  */
	  break;
	case 1:		/* One argument; we already have the
			   type and size.  */
	  args_type[specs[cnt].data_arg] = specs[cnt].data_arg_type;
	  args_size[specs[cnt].data_arg] = specs[cnt].size;
	  break;
	default:
	  /* We have more than one argument for this format spec.
	     We must call the arginfo function again to determine
	     all the types.  */
	  (void) (*__printf_arginfo_table[specs[cnt].info.spec])
	    (&specs[cnt].info,
	     specs[cnt].ndata_args, &args_type[specs[cnt].data_arg],
	     &args_size[specs[cnt].data_arg]);
	  break;
	}
    }
```

- It will build `args_type[] / args_size[]` so it knows how to read each argument (or the stack indexes in case of fmtstring vuln just to make it clear for u)

---

#### Phase three

**This is the devil this is the part that caused me headaches and drove me crazy while trying to know what's the issue with my exploit**.

- This is the part that it reads alllllll the arguments values (again imagine it like the stack indexes in the fmt vuln just to make things easy) into `args_value[]` array and use it for the rest of the do positional loop **this is the freeze part** basically it takes a screenshot for the stack and store it and use it tell the end of the execution of the printf function.

```c
args_value[cnt].mem = va_arg (*ap_savep, type);
```

here it will pull the value from the latest saved va_list and save it into args_value
and then he will use args_value for the rest of the string that's why we say it will take a screenshot of the stack

just like in this chart

![vprintf diagram](/posts-imgs/vprintf/image.png)

---

#### Phase 4

**Execute each specifier in order using the frozen args**.

and after executing all the specifier vfprintf will return back up to the `vfprintf` caller

---

## TL;DR; for the pwners

```md
Using `$` forces glibc to switch into positional mode, where it copies all arguments into an internal array before executing any conversions.

In other words, it takes a snapshot of the argument list at the beginning of the printf call

Because of this: 

- If you modify a stack value using %n
- And you already triggered positional mode with $
- Any later specifier (like %p, %x, %c) will read from the frozen copy not from the live stack

So your modification will not appear during the rest of that printf execution

However if you avoid using `$` glibc stays in the fast path:

- Arguments are consumed sequentially via va_arg.
- Each specifier reads directly from the live argument stream.
- A modification made by %n can affect later reads.

So if your exploit relies on:

> Modify → Then reuse the modified value

Do not trigger positional mode.

Instead of `%7$p`, advance manually using padding like:

`%c%c%c%c`

so that you reach the desired argument without introducing $.
```

### show case

- first the fast path example

```c
#include <stdio.h>

int main() {
    int x = 0x41414141;

    printf("Before: x = 0x%x\n", x);
    printf("%n", &x);
    printf("After:  x = 0x%x\n", x);

    return 0;
}
```

```bash
Before: x = 0x41414141
After:  x = 0x0
```
notice here x got modified and u printed it sucessfully 

- second the positional path example

```c
#include <stdio.h>

int main() {
    int x = 0x41414141;

    printf("Before: x = 0x%x\n", x);

    printf("During: x = %1$n 0x%2$x\n", &x, x);
    return 0;
}
```

```bash
Before: x = 0x41414141
During: x =  0x41414141
```

- and as we expected it printed the same value not `0`

---

That's it we reached the end.

If there’s one thing you should take away from this writeup, let it be this:

When exploiting a format string vulnerability if your exploit:

- modifies a stack value using `%n`
- Then expects to use that modified value somehow later

It will behave differently depending on whether `$` was used.